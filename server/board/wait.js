'use strict';
// Shared idle/exit detection for a line's data pipe, exposed as `sb wait` (a
// plain CLI command, backgroundable via any shell's job control or a harness's
// own background-task mechanism). Deliberately NOT also an MCP tool: a blocking
// wait tool is only useful if the MCP client can background an arbitrary tool
// call, and Claude Code can't — such a tool would just wedge the calling turn.
const { connectPipe, dataPipe, EXIT_RE } = require('./lib');
// EXIT_RE (the board's data-pipe farewell sentinel) and the string it matches
// both live in lib.js, so a reworded farewell can't silently break detection.

// The canonical "quiet" threshold: no new bytes for this long counts as idle.
// Exported so every consumer — `sb wait` and the session DTO's running/idle
// attention state (server/src/sessions.js) — shares one definition instead of
// growing a second.
const DEFAULT_IDLE_MS = 12000;

// Block until a line goes quiet (no new bytes for idleMs) or exits, whichever
// comes first, up to maxWaitMs. Detection only: this cannot tell "finished" from
// "waiting on a decision" from "wedged" — read the line's own output for that.
function waitForIdleOrExit(id, { idleMs = DEFAULT_IDLE_MS, maxWaitMs = 600000 } = {}) {
  const pollMs = Math.min(2000, Math.max(250, Math.floor(idleMs / 4)));
  return new Promise((resolve, reject) => {
    connectPipe(dataPipe(id), { retries: 3, delay: 50 }).then(sock => {
      const start = Date.now();
      let tail = '';
      let lastActivity = start;
      let done = false;
      const hardStop = setTimeout(() => finish('timeout'), maxWaitMs);
      const poll = setInterval(() => {
        if (Date.now() - lastActivity >= idleMs) finish('idle');
      }, pollMs);
      function finish(reason) {
        if (done) return;
        done = true;
        clearTimeout(hardStop);
        clearInterval(poll);
        try { sock.end(); } catch { /* already closed */ }
        const m = EXIT_RE.exec(tail);
        resolve({ reason, exitCode: m ? Number(m[1]) : null, waitedMs: Date.now() - start });
      }
      sock.on('data', d => {
        lastActivity = Date.now();
        tail = (tail + d.toString('latin1')).slice(-200);
      });
      sock.on('close', () => finish('exit'));
      sock.on('error', () => finish('exit'));
    }, reject);
  });
}

module.exports = { waitForIdleOrExit, EXIT_RE, DEFAULT_IDLE_MS };
