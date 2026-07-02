'use strict';
// Low-level client for the vendored switchboard board (the PTY kernel). This is
// the single seam where the board's telephone vocabulary (line / call / patch /
// hangup) is spoken; everything above it deals in "sessions". The web tier never
// imports node-pty or the board internals directly.
const { connectPipe, connectControl, dataPipe, rpc } = require('../board/lib');
const { EXIT_RE, DEFAULT_IDLE_MS } = require('../board/wait'); // shared exit sentinel + idle threshold, one source of truth

// rpc() (one control request -> one response, with a timeout) now lives in
// board/lib.js so its framing can't drift from sb.js / mcp-server.js.

// Attach to a line's raw byte stream. Scrollback replays automatically on connect.
// Opens a dedicated control connection too, so this client's resizes register as a
// distinct pane (preserving the board's smallest-client resize clamp). Mirrors
// patch.js: one control + one data connection per attached client.
async function attach(id, { onData, onExit } = {}) {
  const data = await connectPipe(dataPipe(id), { retries: 20 });
  let ctrl = null;
  try { ctrl = await connectControl({ autostart: false }); } catch { /* resize just no-ops */ }

  let tail = '';                             // rolling buffer to recover the exit code on close
  data.on('data', d => {
    tail = (tail + d.toString('latin1')).slice(-200);
    if (onData) onData(d);
  });
  let fired = false;
  const end = () => {
    if (fired) return; fired = true;
    const m = EXIT_RE.exec(tail);
    if (onExit) onExit(m ? Number(m[1]) : null);
  };
  data.on('close', end);
  data.on('error', end);

  return {
    write: d => { try { data.write(d); } catch { /* closed */ } },
    resize: (cols, rows) => {
      if (ctrl) { try { ctrl.write(JSON.stringify({ cmd: 'resize', id, cols, rows }) + '\n'); } catch { /* closed */ } }
    },
    detach: () => { try { data.end(); } catch {} if (ctrl) { try { ctrl.end(); } catch {} } },
  };
}

// DEFAULT_IDLE_MS rides through this seam so sessions.js never imports board
// internals directly — the same "quiet" definition sb wait and the MCP tool use.
module.exports = { rpc, attach, DEFAULT_IDLE_MS };
