'use strict';
// Shared bits: pipe names, board auto-start, and pipe-connect-with-retry.
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

// Own pipe namespace so the agent-relay board is independent of any standalone
// switchboard board (which uses \\.\pipe\switchboard). They never collide.
// AGENT_RELAY_PIPE overrides the base name to run an isolated board (tests,
// parallel instances); board.js and every client must share the same value.
const PIPE_BASE = process.env.AGENT_RELAY_PIPE || 'agent-relay';
const CTRL = `\\\\.\\pipe\\${PIPE_BASE}`;
const dataPipe = id => `\\\\.\\pipe\\${PIPE_BASE}.${id}`;

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

// Connect to an arbitrary named pipe, retrying through transient errors
// (server not up yet / all instances momentarily busy).
function connectPipe(pipePath, { retries = 30, delay = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      const sock = net.connect(pipePath);
      sock.once('connect', () => {
        sock.removeAllListeners('error');
        sock.on('error', () => {});
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

module.exports = { CTRL, dataPipe, startBoard, connectPipe, connectControl, rpc, RPC_TIMEOUT_MS, lineClosedFarewell, EXIT_RE };
