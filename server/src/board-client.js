'use strict';
// The single seam where the board's telephone vocabulary (line/call/patch/hangup)
// is spoken; everything above it deals in "sessions". The web tier never imports
// node-pty or the board internals directly.
const { connectPipe, connectControl, dataPipe, rpc } = require('../board/lib');
const { EXIT_RE, DEFAULT_IDLE_MS } = require('../board/wait'); // shared exit sentinel + idle threshold, one source of truth

// Attaches to a line's byte stream (scrollback replays once the data pipe
// connects). Data and control sockets are independent on purpose: data stays
// open for the replay's whole life, while control toggles via setSpectator so a
// focus change can enter/leave the board's resize clamp without re-triggering replay.
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
    // Toggles clamp participation without touching the data pipe: interactive
    // opens a control socket (next resize re-enters the clamp), spectator closes
    // it and the board frees this pane's size.
    setSpectator: async (on) => { if (on) closeCtrl(); else await openCtrl(); },
    detach: () => { try { data.end(); } catch {} closeCtrl(); },
  };
}

// DEFAULT_IDLE_MS rides through this seam so sessions.js never imports board
// internals directly — the same "quiet" definition sb wait and the MCP tool use.
module.exports = { rpc, attach, DEFAULT_IDLE_MS };
