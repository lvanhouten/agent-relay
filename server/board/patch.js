'use strict';
// A dumb raw relay between this terminal and a line. Runs inside a spawned
// WezTerm pane (`sb join`) or the caller's own terminal (`sb join --here`).
// argv: <line-id> [detach-byte]
//   detach-byte - decimal code of a key that detaches (returns to the caller's
//   shell) instead of forwarding to the PTY. Omitted for a spawned pane, where
//   closing the tab is the exit; supplied for --here so the caller isn't
//   trapped with no way back (Ctrl+] = 29).
const { CTRL, dataPipe, connectPipe } = require('./lib');
const net = require('net');

const id = process.argv[2];
const detachByte = process.argv[3] ? Number(process.argv[3]) : null;
if (!id) {
  process.stderr.write('usage: patch <line-id> [detach-byte]\n');
  process.exit(1);
}

(async () => {
  // Control connection, used only to forward this pane's size to the PTY.
  // Don't autostart the board - if it's down there are no lines to patch.
  let ctrl;
  try {
    ctrl = await connectPipe(CTRL, { retries: 10 });
  } catch (e) {
    process.stderr.write(`switchboard: board offline (${e.code || e.message})\n`);
    process.exit(1);
  }

  const sendResize = () => {
    if (process.stdout.columns) {
      ctrl.write(JSON.stringify({
        cmd: 'resize', id,
        cols: process.stdout.columns,
        rows: process.stdout.rows,
      }) + '\n');
    }
  };
  process.stdout.on('resize', sendResize);

  let data;
  try {
    data = await connectPipe(dataPipe(id), { retries: 20 });
  } catch (e) {
    process.stderr.write(`switchboard: cannot patch into line ${id} (${e.code || e.message})\n`);
    process.exit(1);
  }

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  if (detachByte != null) {
    // Watch for the detach key; forward every other byte to the PTY. On detach,
    // restore the terminal and exit 0 - the line keeps running on the board.
    process.stdin.on('data', chunk => {
      const i = chunk.indexOf(detachByte);
      if (i === -1) { data.write(chunk); return; }
      if (i > 0) data.write(chunk.subarray(0, i));
      process.stdout.write('\r\n[detached]\r\n');
      process.exit(0);
    });
  } else {
    process.stdin.pipe(data);   // keystrokes -> PTY
  }
  data.pipe(process.stdout);  // PTY output -> screen
  sendResize();

  const cleanup = () => {
    if (process.stdin.isTTY) { try { process.stdin.setRawMode(false); } catch { /* ignore */ } }
  };
  process.on('exit', cleanup);
  data.on('close', () => process.exit(0));
  data.on('error', () => process.exit(0));
})();
