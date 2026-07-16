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

// A fresh high-entropy secret, in memory only. Split out from persistence so the
// daemon can generate + hold the secret BEFORE it wins the control-pipe bind, and
// write it to disk ONLY after the bind succeeds — a process that loses the bind
// race then never overwrites the winner's on-disk secret.
function generateSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

// Persist an already-generated secret to the owner-only secret file. `file` is
// injectable for tests. (On Windows the mode bits are inert — the real boundary
// is the inherited profile-directory ACL; see the SECRET_DIR comment above.)
function persistSecret(secret, file = secretPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

// Generate a fresh secret and persist it in one step (owner-only), for callers
// that want the atomic behavior; the daemon uses the generate/persist split above
// instead, so it can order persistence after the bind.
function writeBootSecret(file = secretPath()) {
  return persistSecret(generateSecret(), file);
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

// Cap on the pre-auth accumulator (both pipe planes). A foreign process that can
// open a pipe under the OS default DACL but doesn't know the secret can stream
// bytes with no newline; without a cap the accumulated string grows until it hits
// V8's max string length, whose RangeError throws SYNCHRONOUSLY inside the
// 'data' listener — and there is no uncaughtException handler in the board, so
// that one connection crashes the whole daemon and every live line with it.
// A legitimate secret line is ~43 bytes, so 4096 is generous headroom.
const MAX_PREAUTH_BYTES = 4096;

// The shared pre-auth handshake used by BOTH pipe planes (data + control). Each
// plane must: accumulate incoming bytes until the first newline, cap that pre-auth
// buffer, strip a trailing \r, and constant-time-compare the first line to the
// secret. Centralized here, with secretEqual/AUTH_TIMEOUT_MS/the cap, so the
// compare and the cap can never diverge between the two planes.
//
// Per-connection: create one, feed() each raw 'data' chunk to it until it returns
// a terminal result. Note it decodes each chunk independently (utf8); the split-
// multibyte edge is a known, out-of-scope limitation, intentionally NOT handled here.
//   { type: 'pending' }         still accumulating, under the cap — caller waits
//   { type: 'overflow' }        pre-auth cap exceeded — caller destroys the socket
//   { type: 'reject' }          first line != secret — caller destroys the socket
//   { type: 'accept', rest }    secret matched; `rest` = bytes after the first \n
// After 'accept' the caller owns the byte stream; do not feed() again.
function makeHandshake(secret, { cap = MAX_PREAUTH_BYTES } = {}) {
  let buf = '';
  return {
    feed(chunk) {
      buf += chunk.toString('utf8');
      const i = buf.indexOf('\n');
      if (i < 0) return buf.length > cap ? { type: 'overflow' } : { type: 'pending' };
      const provided = buf.slice(0, i).replace(/\r$/, '');
      const rest = buf.slice(i + 1);
      if (!secretEqual(provided, secret)) return { type: 'reject' };
      return { type: 'accept', rest };
    },
  };
}

// Cap on the post-auth control-plane command buffer. Pre-auth is capped by
// makeHandshake; post-auth an authenticated client still accumulates bytes until a
// newline before a JSON command is parsed, so an oversized newline-less command
// has the same unbounded-growth → RangeError → daemon-crash shape. Set well
// above any legitimate command (a `new` with a long `run` field is still tiny
// relative to this) and far below V8's limit, so only a pathological stream trips
// it. The data plane needs no post-auth cap: after auth it pumps raw bytes
// straight to the pty without accumulating.
const MAX_CMD_BYTES = 1024 * 1024;

// Post-auth control-plane command accumulator, with the MAX_CMD_BYTES cap. Mirrors
// makeHandshake (pure, no socket) so the cap is unit-testable rather than buried in
// the control server's inline data handler. Seed with the post-handshake leftover
// bytes, then feed() each chunk (already utf8-decoded): it returns the complete
// newline-terminated command lines and flags `overflow` when the un-terminated
// tail — an oversized newline-less command — blows the cap, exactly as the inline
// code did (split first, then cap the remainder). On overflow the caller destroys
// the socket. Call feed('') once right after seeding to drain any commands that
// arrived bundled in the same chunk as the secret line.
function makeCommandBuffer(rest = '', { cap = MAX_CMD_BYTES } = {}) {
  let buf = rest;
  return {
    feed(chunk) {
      buf += chunk;
      const lines = [];
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); }
      return { lines, overflow: buf.length > cap };
    },
  };
}

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
//
// Returns false when the secret file isn't on disk yet. The board persists its
// secret just AFTER binding the pipe (a bind-race loser must not reach persist and
// clobber the winner's on-disk secret), so there's a narrow
// window — widened under concurrent load — where the pipe accepts a connection
// before the secret exists. Writing an empty secret there gets the socket rejected
// and destroyed ("board closed the connection before replying"), so instead the
// caller treats a false return as not-ready-yet and retries the connect.
function sendSecret(sock, read = readSecret) {
  const secret = read();
  // Falsy covers both windows: the file absent yet (readSecret -> null) AND the
  // file existing but empty because writeFileSync truncates to 0 bytes before
  // writing (readSecret -> ''). Either way the board isn't ready; return false so
  // the caller retries rather than presenting an empty secret and being rejected.
  if (!secret) return false;
  try { sock.write(secret + '\n'); } catch { /* socket already closed */ }
  return true;
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
        if (!sendSecret(sock)) {   // board up but secret not persisted yet — retry
          sock.destroy();
          if (n <= 0) return reject(new Error('board secret unavailable after retries'));
          return setTimeout(() => attempt(n - 1), delay);
        }
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
        if (!sendSecret(sock)) {   // board bound the pipe but hasn't persisted its secret yet — retry
          sock.destroy();
          if (n <= 0) return reject(new Error('board secret unavailable after retries'));
          return setTimeout(() => attempt(n - 1), delay);
        }
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
  generateSecret, persistSecret, writeBootSecret, readSecret, secretEqual, secretPath,
  sendSecret,
  AUTH_TIMEOUT_MS, MAX_PREAUTH_BYTES, MAX_CMD_BYTES, makeHandshake, makeCommandBuffer,
};
