'use strict';
// The board: a long-lived daemon that owns every PTY ("line").
// Clients talk to it over the control pipe; each line gets its own raw data pipe.
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const pty = require('node-pty');
const { CTRL, dataPipe, lineClosedFarewell } = require('./lib');

const LOG = path.join(__dirname, 'switchboard.log');
const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`;
  try { fs.appendFileSync(LOG, line); } catch { /* best effort */ }
  if (process.stdout.isTTY) process.stdout.write(line);
};

const DEFAULT_SHELL = process.platform === 'win32'
  ? 'pwsh.exe'
  : (process.env.SHELL || 'bash');

const SCROLLBACK = 2000; // chunks of output replayed to a freshly-patched pane

// Initial-command ("run" field) keystroke-feed timing. ConPTY drops keystrokes
// fed before the shell's input reader is ready, so we wait for the shell's first
// output (prompt up) — debounced by FEED_DEBOUNCE_MS after each output burst —
// before injecting, with FEED_FALLBACK_MS as a hard backstop for a shell that
// emits nothing on start. Both feed the same one-shot send (`sent` guard).
const FEED_DEBOUNCE_MS = 120;
const FEED_FALLBACK_MS = 1500;

// Per-process boot nonce. Line ids come from `seq`, which resets to 0 on every
// board restart (a designed, autostart-triggered event), so an id like "1" is
// reused across restarts. Clients that cache per-line state (e.g. mcp-server's
// read cursor) must namespace it by this nonce so a reused id can't inherit a
// stale entry from a previous board process.
const BOOT = `${process.pid}-${Date.now()}`;

const sessions = new Map(); // id -> { pty, clients:Set<socket>, buf:[], sizes, server, name, shell, cwd, startedAt, lastActivity }
let seq = 0;

function createLine(o = {}) {
  const id = String(++seq);
  const shell = o.shell || DEFAULT_SHELL;
  const cwd = o.cwd || process.env.USERPROFILE || process.cwd();
  const p = pty.spawn(shell, o.args || [], {
    name: 'xterm-256color',
    cols: o.cols || 120,
    rows: o.rows || 30,
    cwd,
    env: process.env,
  });
  const now = Date.now();
  const s = { pty: p, clients: new Set(), buf: [], sizes: new Map(), name: o.name || '', shell, cwd, startedAt: now, lastActivity: now };
  sessions.set(id, s);

  // Data plane: a dumb raw byte pump, broadcast to every patched-in pane.
  const server = net.createServer(sock => {
    s.clients.add(sock);
    for (const chunk of s.buf) sock.write(chunk);   // replay scrollback on attach
    sock.on('data', d => p.write(d.toString('utf8')));
    sock.on('close', () => s.clients.delete(sock));
    sock.on('error', () => s.clients.delete(sock));
  });
  server.on('error', e => log('data pipe error on line', id, e.message));
  server.listen(dataPipe(id));
  s.server = server;

  p.onData(d => {
    s.lastActivity = Date.now();
    s.buf.push(d);
    if (s.buf.length > SCROLLBACK) s.buf.shift();
    for (const c of s.clients) c.write(d);
  });
  p.onExit(({ exitCode }) => {
    for (const c of s.clients) c.end(lineClosedFarewell(id, exitCode));
    try { server.close(); } catch { /* ignore */ }
    sessions.delete(id);
    log('line', id, 'closed, exit', exitCode);
  });

  // Optional initial command: type it into the live shell, which stays interactive
  // afterwards. Wait for the shell's first output (prompt up) before sending —
  // ConPTY drops keystrokes fed before the shell's input reader is ready — with a
  // timer fallback in case the shell is silent on start. Fires at most once.
  // (Timing rationale + constants: see FEED_DEBOUNCE_MS / FEED_FALLBACK_MS above.)
  const run = typeof o.run === 'string' ? o.run.trim() : '';
  if (run) {
    let sent = false;
    const feed = () => {
      if (sent || !sessions.has(id)) return;
      sent = true;
      try { p.write(run + '\r'); } catch { /* line closed */ }
    };
    p.onData(() => setTimeout(feed, FEED_DEBOUNCE_MS));
    setTimeout(feed, FEED_FALLBACK_MS);
    // Log only that a run command exists and its length, not its text — the
    // command can embed a credential as an argv (e.g. --api-key=...) and
    // switchboard.log is persistent and unrotated.
    log('line', id, 'will run a command', `(${run.length} chars)`);
  }

  log('line', id, 'placed:', shell, 'in', cwd);
  return id;
}

// A valid terminal dimension: a finite positive integer. Guards the resize path
// so garbage can't poison a line's size via NaN (see the 'resize' handler).
const isDim = n => Number.isInteger(n) && n > 0;

// Clamp a line's PTY to its smallest patched pane (tmux-style) so no pane renders
// garbled. Each pane reports its size over its long-lived control socket; we key
// by that socket and resize the PTY to the min across all currently-patched panes.
function applyMin(s) {
  if (!s.sizes.size) return;
  let cols = Infinity, rows = Infinity;
  for (const sz of s.sizes.values()) { cols = Math.min(cols, sz.cols); rows = Math.min(rows, sz.rows); }
  try { s.pty.resize(cols, rows); } catch { /* line may have closed */ }
}

// Open a fresh pane/window patched through to a line. The launch recipe comes
// from the client (sb) — only it can see the caller's terminal. Falls back to
// WezTerm when the recipe is absent (older client / undetectable caller).
const DEFAULT_RECIPE = { file: 'wezterm', args: ['cli', 'spawn', '--', '{cmd}'], env: {} };

function openPane(id, recipe) {
  const r = recipe && recipe.file ? recipe : DEFAULT_RECIPE;
  const cmd = [process.execPath, path.join(__dirname, 'patch.js'), id];
  // The {cmd} token is only substituted when it's its OWN argv element. If a
  // recipe embeds it inside a larger string (e.g. SWITCHBOARD_TERM="sh -c
  // '{cmd}'" splits to ["sh","-c","'{cmd}'"]), no element equals '{cmd}', so it
  // would silently spawn with the literal token and the pane never patches in.
  // Detect that and refuse loudly instead of spawning a broken pane.
  const hasStandaloneToken = r.args.some(a => a === '{cmd}');
  const hasEmbeddedToken = r.args.some(a => a !== '{cmd}' && a.includes('{cmd}'));
  if (!hasStandaloneToken) {
    log('pane spawn skipped for line', id, '- recipe has no standalone {cmd} arg',
      hasEmbeddedToken ? '({cmd} is embedded in a larger string — it must be its own argument; join the line manually with `sb join ' + id + '`)' : '');
    return;
  }
  const args = r.args.flatMap(a => (a === '{cmd}' ? cmd : [a]));
  const child = spawn(r.file, args, {
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ...(r.env || {}) },
  });
  child.on('error', e => log('pane spawn failed for line', id, 'via', r.file, '-', e.message));
  child.unref();
}

function handle(m, sock) {
  switch (m.cmd) {
    case 'new': {
      const id = createLine(m);
      if (m.open !== false) openPane(id, m.spawn);
      const s = sessions.get(id);
      sock.write(JSON.stringify({ ok: true, boot: BOOT, id, pid: s.pty.pid, shell: s.shell, name: s.name, cwd: s.cwd, dataPipe: dataPipe(id) }) + '\n');
      break;
    }
    case 'list': {
      const lines = [...sessions].map(([id, s]) => ({
        id,
        name: s.name,
        pid: s.pty.pid,
        shell: s.shell,
        cwd: s.cwd,
        joined: s.clients.size,
        uptimeMs: Date.now() - s.startedAt,
        idleMs: Date.now() - s.lastActivity,
      }));
      sock.write(JSON.stringify({ ok: true, boot: BOOT, lines }) + '\n');
      break;
    }
    case 'join': {
      const s = sessions.get(m.id);
      if (s) openPane(m.id, m.spawn);
      sock.write(JSON.stringify({ ok: !!s, id: m.id, dataPipe: s ? dataPipe(m.id) : null }) + '\n');
      break;
    }
    case 'end': {
      const s = sessions.get(m.id);
      if (s) s.pty.kill();
      sock.write(JSON.stringify({ ok: !!s }) + '\n');
      break;
    }
    case 'resize': {
      const s = sessions.get(m.id);
      // Only store finite positive-integer sizes. A non-numeric value would
      // propagate NaN through every subsequent applyMin (Math.min) for the line
      // and wedge every pane's resize until the poisoned client disconnects.
      if (s && isDim(m.cols) && isDim(m.rows)) { s.sizes.set(sock, { cols: m.cols, rows: m.rows }); applyMin(s); }
      break;
    }
    case 'shutdown': {
      sock.write(JSON.stringify({ ok: true, dropped: sessions.size }) + '\n');
      for (const s of sessions.values()) { try { s.pty.kill(); } catch { /* ignore */ } }
      log('shutting down on request');
      setTimeout(() => process.exit(0), 50);
      break;
    }
    default:
      sock.write(JSON.stringify({ ok: false, error: 'unknown cmd: ' + m.cmd }) + '\n');
  }
}

// Control plane: newline-delimited JSON request/response.
const board = net.createServer(sock => {
  let buf = '';
  sock.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      // Guard the whole command dispatch: a field that doesn't match the assumed
      // shape (e.g. `args` as a non-array) must not throw uncaught here and take
      // down the daemon — and every live line with it — for one bad request.
      try { handle(m, sock); }
      catch (e) { log('handle error for cmd', m && m.cmd, '-', e.message); }
    }
  });
  sock.on('error', () => {});
  // A pane's control socket lives for the pane's lifetime; when it drops, forget
  // that pane's size so the PTY can grow back to the remaining panes' min.
  sock.on('close', () => {
    for (const s of sessions.values()) if (s.sizes.delete(sock)) applyMin(s);
  });
});

board.on('error', e => {
  if (e.code === 'EADDRINUSE') { log('board already running — exiting'); process.exit(0); }
  log('board error:', e.message);
  throw e;
});
board.listen(CTRL, () => log('switchboard online:', CTRL));
