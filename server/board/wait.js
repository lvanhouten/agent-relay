'use strict';
// Shared idle/exit detection for a line's data pipe. Used by both `sb wait`
// (a plain CLI command, backgroundable via any shell's job control or a
// harness's own background-task mechanism) and mcp-server.js's
// switchboard_wait_for_idle tool (backgroundable only by a harness that can
// run an arbitrary MCP tool call in the background — not a given). Two
// callers, one implementation, so the detection logic never drifts between
// them the way board-client.js's rpc() and mcp-server.js's used to.
const { connectPipe, dataPipe, EXIT_RE } = require('./lib');
// EXIT_RE (the board's data-pipe farewell sentinel) and the string it matches
// both live in lib.js now, so a reworded farewell can't silently break detection.

// Block until a line goes quiet (no new bytes for idleMs) or exits, whichever
// comes first, up to maxWaitMs. Detection only: this cannot tell "finished" from
// "waiting on a decision" from "wedged" — read the line's own output for that.
function waitForIdleOrExit(id, { idleMs = 12000, maxWaitMs = 600000 } = {}) {
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

module.exports = { waitForIdleOrExit, EXIT_RE };
