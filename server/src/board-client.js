'use strict';
// The single seam where the board's telephone vocabulary (line/call/patch/hangup)
// is spoken; everything above it deals in "sessions". The web tier never imports
// node-pty or the board internals directly.
const { connectPipe, connectControl, dataPipe, rpc } = require('../board/lib');
const { EXIT_RE, DEFAULT_IDLE_MS } = require('../board/wait'); // shared exit sentinel + idle threshold, one source of truth

// Attaches to a line's byte stream (scrollback replays once the data pipe
// connects). Data and control sockets are independent on purpose: data stays
// open for the replay's whole life, while control toggles via setSizing so a
// focus change can enter/leave the board's resize clamp without re-triggering replay.
async function attach(id, { onData, onExit, sizing = true } = {}) {
  const data = await connectPipe(dataPipe(id), { retries: 20 });
  let ctrl = null;
  // Last size requested while no control socket was open. Opening one is async,
  // so a resize can arrive first — most reliably right after a mode flip, whose
  // openCtrl the caller does not await. Dropping it stranded the PTY at the
  // previous pane's size, so hold it and flush once the socket exists.
  let pendingSize = null;
  const writeSize = (cols, rows) => {
    try { ctrl.write(JSON.stringify({ cmd: 'resize', id, cols, rows }) + '\n'); }
    catch { /* closed */ }
  };
  const openCtrl = async () => {
    if (ctrl) return;
    // A failure here silently disables resize for the whole attach — the view
    // then renders at a size the PTY never learns — so it must not pass unlogged.
    try { ctrl = await connectControl({ autostart: false }); }
    catch (e) { ctrl = null; console.error('[board] control connect failed; resize disabled for line', id, '-', e && e.message ? e.message : e); }
    if (ctrl && pendingSize) { writeSize(pendingSize.cols, pendingSize.rows); pendingSize = null; }
  };
  const closeCtrl = () => { if (ctrl) { try { ctrl.end(); } catch { /* closed */ } ctrl = null; } };
  // No control socket means no clamp membership: a view that doesn't own sizing
  // can never shrink the shared PTY to its own box.
  if (sizing) await openCtrl();

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
      if (ctrl) writeSize(cols, rows);
      else pendingSize = { cols, rows };   // flushed by openCtrl
    },
    // Toggles clamp participation without touching the data pipe: sizing opens a
    // control socket (and flushes any size requested meanwhile), not-sizing
    // closes it and the board frees this view's entry.
    setSizing: async (on) => { if (on) await openCtrl(); else { pendingSize = null; closeCtrl(); } },
    detach: () => { try { data.end(); } catch {} closeCtrl(); },
  };
}

// DEFAULT_IDLE_MS rides through this seam so sessions.js never imports board
// internals directly — the same "quiet" definition sb wait and the MCP tool use.
module.exports = { rpc, attach, DEFAULT_IDLE_MS };
