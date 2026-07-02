'use strict';
// Shared bits: pipe names, board auto-start, pipe-connect-with-retry, and the
// per-boot access secret that gates every pipe connection.
const net = require('net');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Own pipe namespace so the agent-relay board is independent of any standalone
// switchboard board (which uses \\.\pipe\switchboard). They never collide.
// AGENT_RELAY_PIPE overrides the base name to run an isolated board (tests,
// parallel instances); board.js and every client must share the same value.
const PIPE_BASE = process.env.AGENT_RELAY_PIPE || 'agent-relay';
const CTRL = `\\\\.\\pipe\\${PIPE_BASE}`;
const dataPipe = id => `\\\\.\\pipe\\${PIPE_BASE}.${id}`;

// --- board access secret -------------------------------------------------
// The OS default DACL on a named pipe grants Everyone + ANONYMOUS LOGON *read*
// (verified 2026-07-01), so any local user can connect to a line's data pipe and
// read its PTY output. (Write — hence command injection — is already default-
// denied.) Node's net.Server.listen exposes no pipe security-descriptor option,
// so instead the board gates every connection on a per-boot secret: a client
// must send `<secret>\n` as the first bytes on the pipe before the board streams
// scrollback or accepts a command; a connection that doesn't is dropped.
//
// The secret lives in a file only the creating user can read. On Windows that's
// under %LOCALAPPDATA%, which sits inside the user profile — NTFS already denies
// other non-admin users traversal into another profile, so the file location
// alone is the boundary (an admin can read it, but an admin already has full
// access to the pipe itself, so nothing is lost). On POSIX the dir/file are
// created 0700/0600. Namespaced by PIPE_BASE so an isolated board has its own.
const SECRET_DIR = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agent-relay')
  : path.join(os.homedir(), '.agent-relay');
const secretPath = () => path.join(SECRET_DIR, `board.${PIPE_BASE}.secret`);

// Generate a fresh secret and persist it (owner-only). Called once by the board
// daemon at startup, before it starts listening, so the file exists by the time
// any client can successfully connect. `file` is injectable for tests.
function writeBootSecret(file = secretPath()) {
  const secret = crypto.randomBytes(32).toString('base64url');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

// Read the current board's secret. Read fresh on every connect (not cached at
// module load) so a client reconnecting after a board restart picks up the new
// secret instead of presenting a stale one. Returns null if the file is absent.
function readSecret(file = secretPath()) {
  try { return fs.readFileSync(file, 'utf8').trim(); }
  catch { return null; }
}

// Constant-time secret compare (mirrors src/auth.js): length-gate then
// timingSafeEqual so a wrong secret can't be recovered byte-by-byte from timing.
function secretEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// A connection that opens but never presents the secret is dropped after this
// long, so a foreign process can't hold a pre-auth socket open indefinitely.
const AUTH_TIMEOUT_MS = 5000;

// The line's data-pipe farewell sentinel — the single source shared by the
// producer (board.js, which writes it on line exit) and the consumers (wait.js /
// board-client.js, which parse the exit code out of it). Keeping the format and
// its matching regex here stops a reworded farewell from silently breaking
// exit-code detection (which would fail open to exitCode:null with no error).
const lineClosedFarewell = (id, exitCode) => `\r\n[switchboard: line ${id} closed (exit ${exitCode})]\r\n`;
const EXIT_RE = /closed \(exit (-?\d+)\)/;

// Launch the board as a detached daemon that outlives whoever started it.
function startBoard() {
  const child = spawn(process.execPath, [path.join(__dirname, 'board.js')], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

const TRANSIENT = ['ENOENT', 'ECONNREFUSED', 'EBUSY'];

// Present the board secret as the first line on a freshly-connected socket. Every
// client connection (control or data) does this before the board will talk to it.
// The socket stays paused (no 'data' listener added here) so any server output —
// e.g. a data pipe's scrollback replay — is buffered until the caller starts
// reading, never dropped in the gap.
function sendSecret(sock) {
  const secret = readSecret();
  try { sock.write((secret || '') + '\n'); } catch { /* socket already closed */ }
}

// Connect to an arbitrary named pipe, retrying through transient errors
// (server not up yet / all instances momentarily busy).
function connectPipe(pipePath, { retries = 30, delay = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      const sock = net.connect(pipePath);
      sock.once('connect', () => {
        sock.removeAllListeners('error');
        sock.on('error', () => {});
        sendSecret(sock);
        resolve(sock);
      });
      sock.once('error', err => {
        if (!TRANSIENT.includes(err.code) || n <= 0) return reject(err);
        setTimeout(() => attempt(n - 1), delay);
      });
    };
    attempt(retries);
  });
}

// Connect to the control pipe, optionally bringing the board online first.
function connectControl({ autostart = true, retries = 30, delay = 100 } = {}) {
  return new Promise((resolve, reject) => {
    let started = false;
    const attempt = n => {
      const sock = net.connect(CTRL);
      sock.once('connect', () => {
        sock.removeAllListeners('error');
        sock.on('error', () => {});
        sendSecret(sock);
        resolve(sock);
      });
      sock.once('error', err => {
        if (!TRANSIENT.includes(err.code) || n <= 0) return reject(err);
        if (autostart && !started && err.code !== 'EBUSY') {
          startBoard();
          started = true;
        }
        setTimeout(() => attempt(n - 1), delay);
      });
    };
    attempt(retries);
  });
}

// One control RPC: connect, write one JSON line, read one JSON line back, done.
// Owned here (rather than reimplemented in board-client.js / sb.js /
// mcp-server.js) so the framing — and the timeout — can't drift between callers.
// A hung board (accepts the connection but never replies) now rejects after
// `timeout` ms instead of leaving the caller waiting forever.
const RPC_TIMEOUT_MS = 10000;

function rpc(msg, { autostart = true, retries, delay, timeout = RPC_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    connectControl({ autostart, retries, delay }).then(sock => {
      let buf = '';
      let settled = false;
      const done = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { sock.end(); } catch { /* already closed */ }
        fn(arg);
      };
      const timer = setTimeout(
        () => done(reject, new Error(`board rpc timed out after ${timeout}ms`)),
        timeout,
      );
      sock.on('data', d => {
        buf += d;
        const i = buf.indexOf('\n');
        if (i >= 0) {
          let parsed;
          try { parsed = JSON.parse(buf.slice(0, i)); }
          catch (e) { return done(reject, e); }
          done(resolve, parsed);
        }
      });
      sock.on('error', e => done(reject, e));
      sock.on('close', () => done(reject, new Error('board closed the connection before replying')));
      sock.write(JSON.stringify(msg) + '\n');
    }, reject);
  });
}

module.exports = {
  CTRL, dataPipe, startBoard, connectPipe, connectControl, rpc, RPC_TIMEOUT_MS,
  lineClosedFarewell, EXIT_RE,
  writeBootSecret, readSecret, secretEqual, secretPath, AUTH_TIMEOUT_MS,
};
