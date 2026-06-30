'use strict';
// Low-level client for the vendored switchboard board (the PTY kernel). This is
// the single seam where the board's telephone vocabulary (line / call / patch /
// hangup) is spoken; everything above it deals in "sessions". The web tier never
// imports node-pty or the board internals directly.
const { connectControl, connectPipe, dataPipe } = require('../board/lib');

// One request -> one response over a short-lived control connection.
// (call / lines / hangup / shutdown each reply with a single JSON line.)
function rpc(msg, { autostart = true } = {}) {
  return new Promise((resolve, reject) => {
    connectControl({ autostart }).then(sock => {
      let buf = '';
      sock.on('data', d => {
        buf += d;
        const i = buf.indexOf('\n');
        if (i >= 0) { sock.end(); resolve(JSON.parse(buf.slice(0, i))); }
      });
      sock.on('error', reject);
      sock.write(JSON.stringify(msg) + '\n');
    }, reject);
  });
}

const EXIT_RE = /closed \(exit (-?\d+)\)/;   // the board's data-pipe farewell sentinel

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

module.exports = { rpc, attach };
