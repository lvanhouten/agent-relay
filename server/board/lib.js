'use strict';
// Shared bits: pipe names, board autostart, pipe-connect-with-retry, and the
// per-boot access secret gating every connection.
const net = require('net');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Own pipe namespace, independent of a standalone switchboard board (which uses
// \\.\pipe\switchboard) - never collide. AGENT_RELAY_PIPE overrides the base
// name for an isolated board (tests, parallel instances); every client must
// share the same value as board.js.
const PIPE_BASE = process.env.AGENT_RELAY_PIPE || 'agent-relay';
const CTRL = `\\\\.\\pipe\\${PIPE_BASE}`;
const dataPipe = id => `\\\\.\\pipe\\${PIPE_BASE}.${id}`;

// --- board access secret -------------------------------------------------
// The OS default DACL on a named pipe grants Everyone + ANONYMOUS LOGON *read*
// (verified 2026-07-01) - any local user can connect and read a line's PTY
// output (write, hence command injection, is already default-denied). Node's
// net.Server.listen exposes no pipe security-descriptor option, so the board
// gates every connection on a per-boot secret instead: a client must send
// `<secret>\n` first, before scrollback or a command is accepted, or it's dropped.
//
// The secret lives in a file only the creating user can read: on Windows under
// %LOCALAPPDATA%, inside the user profile (NTFS already denies other non-admin
// users traversal into another profile - the location alone is the boundary; an
// admin could read it, but an admin already has full pipe access). POSIX
// creates dir/file 0700/0600. Namespaced by PIPE_BASE so an isolated board gets
// its own.
const SECRET_DIR = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agent-relay')
  : path.join(os.homedir(), '.agent-relay');
const secretPath = () => path.join(SECRET_DIR, `board.${PIPE_BASE}.secret`);

// Fresh high-entropy secret, memory only. Split from persistence so the daemon
// can hold it before winning the bind and write it only after - a bind-race
// loser never overwrites the winner's on-disk secret.
function generateSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

// Persists an already-generated secret to the owner-only file (`file`
// injectable for tests). Windows mode bits are inert - the real boundary is the
// inherited profile-directory ACL (see SECRET_DIR above).
function persistSecret(secret, file = secretPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

// Generates + persists in one atomic step, for callers that don't need the
// daemon's generate/persist split (which orders persistence after the bind).
function writeBootSecret(file = secretPath()) {
  return persistSecret(generateSecret(), file);
}

// Reads fresh on every connect (never cached) so a client reconnecting after a
// board restart picks up the new secret instead of a stale one. Null if absent.
function readSecret(file = secretPath()) {
  try { return fs.readFileSync(file, 'utf8').trim(); }
  catch { return null; }
}

// Constant-time compare (mirrors src/auth.js): length-gate then timingSafeEqual
// so a wrong secret can't be recovered byte-by-byte via timing.
function secretEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// A connection that never presents the secret is dropped after this long, so a
// foreign process can't hold a pre-auth socket open indefinitely.
const AUTH_TIMEOUT_MS = 5000;

// Caps the pre-auth accumulator: a foreign pipe-opener that doesn't know the
// secret could stream newline-less bytes forever, and past V8's max string
// length that throws a RangeError inside the 'data' listener - uncaught, since
// the board has no uncaughtException handler, crashing the daemon and every
// line with it. 4096 is generous headroom over a ~43-byte secret line.
const MAX_PREAUTH_BYTES = 4096;

// Shared pre-auth handshake for both pipe planes (data + control): accumulate
// until the first newline, cap the buffer, strip a trailing \r, and
// constant-time-compare to the secret - centralized so the compare and cap
// can't diverge between planes.
//
// Per-connection: create one, feed() each raw 'data' chunk until a terminal
// result. Decodes each chunk independently (utf8); a split multibyte char at
// the boundary is a known, unhandled edge case.
//   { type: 'pending' }         still accumulating, under the cap - caller waits
//   { type: 'overflow' }        pre-auth cap exceeded - caller destroys the socket
//   { type: 'reject' }          first line != secret - caller destroys the socket
//   { type: 'accept', rest }    secret matched; `rest` = bytes after the first \n
// After 'accept' the caller owns the stream; do not feed() again.
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

// Cap on the post-auth command buffer. An authenticated client still
// accumulates bytes until a newline before parsing JSON, so an oversized
// newline-less command has the same unbounded-growth -> RangeError -> crash
// shape as pre-auth. Set well above any legitimate command, far below V8's
// limit. The data plane needs no such cap - after auth it pumps raw bytes
// straight to the pty.
const MAX_CMD_BYTES = 1024 * 1024;

// Post-auth command accumulator with the MAX_CMD_BYTES cap - mirrors
// makeHandshake (pure, no socket) so the cap is unit-testable rather than
// buried in the control server's data handler. Seed with the post-handshake
// leftover bytes, then feed() each chunk: returns complete newline-terminated
// lines and flags `overflow` when the unterminated tail blows the cap. Call
// feed('') once right after seeding to drain any command bundled with the
// secret line.
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

// The line's data-pipe farewell sentinel, shared by the producer (board.js) and
// consumers (wait.js / board-client.js) that parse the exit code out of it -
// centralized so a reworded farewell can't silently break exit-code detection
// (which fails open to exitCode:null with no error).
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

// Presents the board secret as the first line on a fresh socket - every client
// (control or data) does this before the board will talk. The socket stays
// paused (no 'data' listener here) so server output - e.g. a scrollback replay -
// buffers until the caller starts reading, never dropping in the gap.
//
// Returns false when the secret file isn't on disk yet. The board persists its
// secret just after binding (a bind-race loser must not clobber the winner's
// on-disk secret), so there's a narrow window - wider under load - where the
// pipe accepts before the secret exists. Writing an empty secret there would
// get the socket rejected outright, so instead a false return tells the caller
// to retry the connect.
function sendSecret(sock, read = readSecret) {
  const secret = read();
  // Falsy covers both windows: file absent (readSecret -> null) or present but
  // still empty mid-write (readSecret -> '', writeFileSync truncates first).
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
        if (!sendSecret(sock)) {   // board up but secret not persisted yet - retry
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
        if (!sendSecret(sock)) {   // board bound the pipe but hasn't persisted its secret yet - retry
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

// One control RPC: connect, write one JSON line, read one back, done. Owned
// here (not reimplemented per-caller) so the framing and timeout can't drift
// between board-client.js / sb.js / mcp-server.js. A hung board (accepts but
// never replies) rejects after `timeout` ms instead of waiting forever.
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
