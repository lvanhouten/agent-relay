'use strict';
// The board: a long-lived daemon that owns every PTY ("line").
// Clients talk to it over the control pipe; each line gets its own raw data pipe.
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const pty = require('node-pty');
const { CTRL, dataPipe, lineClosedFarewell, writeBootSecret, secretEqual, AUTH_TIMEOUT_MS } = require('./lib');

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
// emits nothing on start. After a send, FEED_CONFIRM_MS of total silence is read
// as "the shell never reacted, so ConPTY ate the keystrokes" and the feed is
// retried, up to FEED_MAX_SENDS times total. (See makeRunFeeder.)
const FEED_DEBOUNCE_MS = 120;
const FEED_FALLBACK_MS = 1500;
const FEED_CONFIRM_MS = 500;
const FEED_MAX_SENDS = 2;

// State machine for the initial-command feed. Factored out of createLine, with
// its clock/timer/write/liveness injected, so the debounce + retry logic is
// unit-testable without spawning a pty. Drive it with onData() on every PTY
// output burst and onFallback() once after FEED_FALLBACK_MS.
//
// Two problems it fixes over the old inline feed:
//  1. Redundant timers — the old code scheduled a fresh setTimeout on every
//     startup output burst (harmless via a `sent` guard, but wasteful). Here the
//     pre-send debounce is a SINGLE timer, cancelled and rescheduled per burst.
//  2. No delivery confirmation — the old feed wrote once and assumed it landed;
//     a shell whose input reader wasn't ready silently ate the command. Here,
//     after a send we watch for ANY output the shell produces in reaction (a
//     command typed at a live prompt always echoes, before it even runs). Output
//     after a send => delivered, stop. Total silence for FEED_CONFIRM_MS => the
//     send was almost certainly dropped => re-send, capped at FEED_MAX_SENDS.
//
// Double-run safety: a re-send happens ONLY on total post-send silence. The one
// false-positive direction — continued prompt output mistaken for a reaction —
// leans toward "assume delivered" (skip the retry), never toward re-sending. The
// residual double-run risk is a fresh prompt with echo OFF and a command that
// emits nothing, which is rare and bounded to one extra send by FEED_MAX_SENDS.
function makeRunFeeder(run, io) {
  const { write, isAlive, schedule, cancel, now,
    debounceMs = FEED_DEBOUNCE_MS, confirmMs = FEED_CONFIRM_MS, maxSends = FEED_MAX_SENDS } = io;
  let sends = 0;
  let lastSendAt = 0;
  let settled = false;       // saw output after a send => the shell reacted, done
  let debounceTimer = null;
  let confirmTimer = null;

  function send() {
    if (settled || sends >= maxSends || !isAlive()) return;
    sends += 1;
    lastSendAt = now();
    try { write(run + '\r'); } catch { /* line closed */ }
    cancel(confirmTimer);
    confirmTimer = schedule(onConfirm, confirmMs);   // silence after this => retry
  }

  function onConfirm() {
    if (settled || !isAlive()) return;
    send();   // no reaction observed since lastSendAt -> re-send (capped)
  }

  return {
    // Every PTY output burst.
    onData() {
      if (settled) return;
      if (sends === 0) {
        // Pre-send: debounce the first feed until the startup output goes quiet.
        cancel(debounceTimer);
        debounceTimer = schedule(send, debounceMs);
      } else if (now() >= lastSendAt) {
        // Output after our send: the shell reacted -> delivered. Stop retrying.
        settled = true;
        cancel(debounceTimer);
        cancel(confirmTimer);
      }
    },
    // Backstop for a shell that emits nothing at all on startup.
    onFallback() { if (sends === 0) send(); },
    // Test seam.
    _state: () => ({ sends, settled }),
  };
}

// Per-process boot nonce. Line ids come from `seq`, which resets to 0 on every
// board restart (a designed, autostart-triggered event), so an id like "1" is
// reused across restarts. Clients that cache per-line state (e.g. mcp-server's
// read cursor) must namespace it by this nonce so a reused id can't inherit a
// stale entry from a previous board process.
const BOOT = `${process.pid}-${Date.now()}`;

const sessions = new Map(); // id -> { pty, clients:Set<socket>, buf:[], sizes, server, name, shell, cwd, startedAt, lastActivity }
let seq = 0;

// The per-boot access secret every connection must present as its first line
// (see lib.js). Assigned once in the daemon-entry block below, before either
// server starts listening — so it's always set by the time a connection arrives.
// Left null when board.js is merely require()d by a test (no listeners bound).
let SECRET = null;

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

  // Data plane: a dumb raw byte pump, broadcast to every patched-in pane — but
  // gated on the access secret first (see lib.js). Until a client sends
  // `<secret>\n`, it is added to nothing and receives no scrollback, so a foreign
  // reader that can open the pipe (the OS default DACL allows read) still sees
  // nothing. Bytes after the secret line on the same connection are PTY input.
  const server = net.createServer(sock => {
    let authed = false, authBuf = '';
    const authTimer = setTimeout(() => { if (!authed) sock.destroy(); }, AUTH_TIMEOUT_MS);
    const drop = () => { clearTimeout(authTimer); s.clients.delete(sock); };
    sock.on('data', d => {
      if (authed) { p.write(d.toString('utf8')); return; }
      authBuf += d.toString('utf8');
      const i = authBuf.indexOf('\n');
      if (i < 0) { if (authBuf.length > 4096) sock.destroy(); return; }  // cap pre-auth buffer
      const provided = authBuf.slice(0, i).replace(/\r$/, '');
      const rest = authBuf.slice(i + 1);
      if (!secretEqual(provided, SECRET)) { sock.destroy(); return; }
      authed = true;
      clearTimeout(authTimer);
      s.clients.add(sock);
      for (const chunk of s.buf) sock.write(chunk);   // replay scrollback, post-auth
      if (rest) p.write(rest);  // input bytes bundled in the same chunk as the secret line
    });
    sock.on('close', drop);
    sock.on('error', drop);
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
    // This runs in an async pty callback OUTSIDE the control-plane dispatch's
    // try/catch — an uncaught throw here would take down the whole daemon (and
    // every other live line) on one line's exit (N10). notifyClientsClosed guards
    // each client .end() so one wedged pane can't abort the farewell to the rest,
    // nor the cleanup below.
    notifyClientsClosed(s.clients, lineClosedFarewell(id, exitCode));
    try { server.close(); } catch { /* ignore */ }
    sessions.delete(id);
    log('line', id, 'closed, exit', exitCode);
  });

  // Optional initial command: type it into the live shell, which stays interactive
  // afterwards. Wait for the shell's first output (prompt up) before sending —
  // ConPTY drops keystrokes fed before the shell's input reader is ready — then
  // confirm the shell reacted and retry if it didn't, with a hard fallback for a
  // shell that's silent on start. (Logic + timing: see makeRunFeeder above.)
  const run = typeof o.run === 'string' ? o.run.trim() : '';
  if (run) {
    const feeder = makeRunFeeder(run, {
      write: d => p.write(d),
      isAlive: () => sessions.has(id),
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: t => clearTimeout(t),
      now: () => Date.now(),
    });
    p.onData(() => feeder.onData());
    setTimeout(() => feeder.onFallback(), FEED_FALLBACK_MS);
    // Log only that a run command exists and its length, not its text — the
    // command can embed a credential as an argv (e.g. --api-key=...) and
    // switchboard.log is persistent and unrotated.
    log('line', id, 'will run a command', `(${run.length} chars)`);
  }

  log('line', id, 'placed:', shell, 'in', cwd);
  return id;
}

// Send the farewell to every patched-in client, guarding each write so one
// socket in a bad state can't throw and abort the loop (leaving other panes
// un-notified) or the caller's post-loop cleanup. Factored out of p.onExit so the
// per-client isolation (N10) is unit-testable without spawning a pty.
function notifyClientsClosed(clients, farewell) {
  for (const c of clients) { try { c.end(farewell); } catch { /* pane already gone */ } }
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

// Decide whether a launch recipe can spawn a working pane. The {cmd} token is
// only substituted when it's its OWN argv element. If a recipe embeds it inside a
// larger string (e.g. SWITCHBOARD_TERM="sh -c '{cmd}'" splits to
// ["sh","-c","'{cmd}'"]), no element equals '{cmd}', so it would silently spawn
// with the literal token and the pane never patches in. Factored out so the
// refusal logic is unit-testable without launching a process.
function paneSpawnDecision(recipe) {
  const r = recipe && recipe.file ? recipe : DEFAULT_RECIPE;
  const standalone = r.args.some(a => a === '{cmd}');
  const embedded = r.args.some(a => a !== '{cmd}' && a.includes('{cmd}'));
  return { recipe: r, standalone, embedded };
}

// Returns true if a pane process was spawned, false if the recipe was refused
// (no standalone {cmd} arg). The caller threads this into the RPC reply so a
// misconfigured SWITCHBOARD_TERM surfaces as paneOpened:false instead of a silent
// ok:true with no window (N7's residual / new-N1). Note this reports the spawn
// *attempt*, not the pane's eventual liveness — a spawn that later errors is
// reported asynchronously via the child 'error' log, which openPane can't await.
function openPane(id, recipe) {
  const { recipe: r, standalone, embedded } = paneSpawnDecision(recipe);
  const cmd = [process.execPath, path.join(__dirname, 'patch.js'), id];
  if (!standalone) {
    log('pane spawn skipped for line', id, '- recipe has no standalone {cmd} arg',
      embedded ? '({cmd} is embedded in a larger string — it must be its own argument; join the line manually with `sb join ' + id + '`)' : '');
    return false;
  }
  const args = r.args.flatMap(a => (a === '{cmd}' ? cmd : [a]));
  const child = spawn(r.file, args, {
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ...(r.env || {}) },
  });
  child.on('error', e => log('pane spawn failed for line', id, 'via', r.file, '-', e.message));
  child.unref();
  return true;
}

function handle(m, sock) {
  switch (m.cmd) {
    case 'new': {
      const id = createLine(m);
      // paneOpened: true/false when a pane was requested (so a caller learns a
      // refused recipe didn't produce a window — N7/new-N1); null when no pane was
      // requested at all (open:false — the web/MCP case, the browser is the pane).
      const paneOpened = m.open !== false ? openPane(id, m.spawn) : null;
      const s = sessions.get(id);
      sock.write(JSON.stringify({ ok: true, boot: BOOT, id, pid: s.pty.pid, shell: s.shell, name: s.name, cwd: s.cwd, dataPipe: dataPipe(id), paneOpened }) + '\n');
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
      // paneOpened: the result of the join's whole point (opening a pane), or null
      // when the line doesn't exist so no pane was even attempted (N7/new-N1).
      const paneOpened = s ? openPane(m.id, m.spawn) : null;
      sock.write(JSON.stringify({ ok: !!s, id: m.id, dataPipe: s ? dataPipe(m.id) : null, paneOpened }) + '\n');
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

// Control plane: newline-delimited JSON request/response. The first line on each
// connection must be the access secret (see lib.js); a connection that presents
// the wrong secret — or none within AUTH_TIMEOUT_MS — is dropped before any
// command is dispatched, so a foreign process that can open the control pipe
// still can't list, spawn, resize, or shut down lines.
const board = net.createServer(sock => {
  let buf = '';
  let authed = false;
  const authTimer = setTimeout(() => { if (!authed) sock.destroy(); }, AUTH_TIMEOUT_MS);
  sock.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!authed) {
        if (!secretEqual(line.replace(/\r$/, ''), SECRET)) { sock.destroy(); return; }
        authed = true;
        clearTimeout(authTimer);
        continue;
      }
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
    clearTimeout(authTimer);
    for (const s of sessions.values()) if (s.sizes.delete(sock)) applyMin(s);
  });
});

board.on('error', e => {
  if (e.code === 'EADDRINUSE') { log('board already running — exiting'); process.exit(0); }
  log('board error:', e.message);
  throw e;
});

// Only bind the control pipe when run as the daemon (`node board.js`); when
// required by a test, just expose the pure helpers below.
if (require.main === module) {
  // Generate + persist the access secret BEFORE listening, so it exists by the
  // time any client can connect (autostart included). Every data pipe created
  // later reads the same module-level SECRET.
  SECRET = writeBootSecret();
  board.listen(CTRL, () => log('switchboard online:', CTRL));
}

module.exports = { paneSpawnDecision, openPane, handle, notifyClientsClosed, makeRunFeeder };
