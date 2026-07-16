'use strict';
// Low-level client for the vendored switchboard board (the PTY kernel). This is
// the single seam where the board's telephone vocabulary (line / call / patch /
// hangup) is spoken; everything above it deals in "sessions". The web tier never
// imports node-pty or the board internals directly.
const { connectPipe, connectControl, dataPipe, rpc } = require('../board/lib');
const { EXIT_RE, DEFAULT_IDLE_MS } = require('../board/wait'); // shared exit sentinel + idle threshold, one source of truth

// rpc() (one control request -> one response, with a timeout) now lives in
// board/lib.js so its framing can't drift from sb.js / mcp-server.js.

// Attach to a line's raw byte stream. Scrollback replays automatically when the
// DATA pipe connects. A separate CONTROL connection makes this client a distinct
// pane in the board's smallest-client resize clamp (board.js frees the pane's
// size when that control socket closes). The two are deliberately independent:
// the data pipe stays open for the attach's whole life so the reconstructed
// replay fires exactly once, while the control socket is toggled by setSpectator
// so a grid pane can enter/leave the clamp on focus change WITHOUT re-triggering
// that replay (ADR-0005 live mode-switch). Mirrors patch.js: one control + one
// data connection per interactive client.
async function attach(id, { onData, onExit, spectator = false } = {}) {
  const data = await connectPipe(dataPipe(id), { retries: 20 });
  let ctrl = null;
  const openCtrl = async () => {
    if (ctrl) return;
    try { ctrl = await connectControl({ autostart: false }); } catch { ctrl = null; /* resize just no-ops */ }
  };
  const closeCtrl = () => { if (ctrl) { try { ctrl.end(); } catch { /* closed */ } ctrl = null; } };
  // A spectator owns no control socket, so it never enters the clamp and can't
  // shrink the shared PTY to a small pane.
  if (!spectator) await openCtrl();

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
    // Toggle clamp participation without disturbing the data pipe. Interactive
    // opens a control socket (its next resize re-enters the clamp); spectator
    // closes it, and the board frees this pane's size on the close.
    setSpectator: async (on) => { if (on) closeCtrl(); else await openCtrl(); },
    detach: () => { try { data.end(); } catch {} closeCtrl(); },
  };
}

// DEFAULT_IDLE_MS rides through this seam so sessions.js never imports board
// internals directly — the same "quiet" definition sb wait and the MCP tool use.
module.exports = { rpc, attach, DEFAULT_IDLE_MS };
