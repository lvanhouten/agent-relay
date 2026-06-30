'use strict';
// Runs inside a WezTerm pane: a dumb raw relay between this terminal and a line.
// argv: <line-id>
const { CTRL, dataPipe, connectPipe } = require('./lib');
const net = require('net');

const id = process.argv[2];
if (!id) {
  process.stderr.write('usage: patch <line-id>\n');
  process.exit(1);
}

(async () => {
  // Control connection, used only to forward this pane's size to the PTY.
  // Don't autostart the board — if it's down there are no lines to patch.
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
  process.stdin.pipe(data);   // keystrokes -> PTY
  data.pipe(process.stdout);  // PTY output -> screen
  sendResize();

  const cleanup = () => {
    if (process.stdin.isTTY) { try { process.stdin.setRawMode(false); } catch { /* ignore */ } }
  };
  process.on('exit', cleanup);
  data.on('close', () => process.exit(0));
  data.on('error', () => process.exit(0));
})();
