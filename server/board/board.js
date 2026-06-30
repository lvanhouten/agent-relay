'use strict';
// The board: a long-lived daemon that owns every PTY ("line").
// Clients talk to it over the control pipe; each line gets its own raw data pipe.
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const pty = require('node-pty');
const { CTRL, dataPipe } = require('./lib');

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
    for (const c of s.clients) c.end(`\r\n[switchboard: line ${id} closed (exit ${exitCode})]\r\n`);
    try { server.close(); } catch { /* ignore */ }
    sessions.delete(id);
    log('line', id, 'closed, exit', exitCode);
  });

  // Optional initial command: type it into the live shell, which stays interactive
  // afterwards. Wait for the shell's first output (prompt up) before sending —
  // ConPTY drops keystrokes fed before the shell's input reader is ready — with a
  // timer fallback in case the shell is silent on start. Fires at most once.
  const run = typeof o.run === 'string' ? o.run.trim() : '';
  if (run) {
    let sent = false;
    const feed = () => {
      if (sent || !sessions.has(id)) return;
      sent = true;
      try { p.write(run + '\r'); } catch { /* line closed */ }
    };
    p.onData(() => setTimeout(feed, 120));
    setTimeout(feed, 1500);
    log('line', id, 'will run:', run);
  }

  log('line', id, 'placed:', shell, 'in', cwd);
  return id;
}

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
      sock.write(JSON.stringify({ ok: true, id, pid: s.pty.pid, shell: s.shell, name: s.name, dataPipe: dataPipe(id) }) + '\n');
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
      sock.write(JSON.stringify({ ok: true, lines }) + '\n');
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
      if (s) { s.sizes.set(sock, { cols: m.cols, rows: m.rows }); applyMin(s); }
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
      handle(m, sock);
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
