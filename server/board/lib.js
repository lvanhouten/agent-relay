'use strict';
// Shared bits: pipe names, board auto-start, and pipe-connect-with-retry.
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

// Own pipe namespace so the agent-relay board is independent of any standalone
// switchboard board (which uses \\.\pipe\switchboard). They never collide.
const CTRL = '\\\\.\\pipe\\agent-relay';
const dataPipe = id => `\\\\.\\pipe\\agent-relay.${id}`;

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

module.exports = { CTRL, dataPipe, startBoard, connectPipe, connectControl };
