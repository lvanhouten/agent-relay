'use strict';
// Integration guard for the spectator-attach dims contract (ADR-0005 point 1):
// the `list` reply carries each live line's current PTY `cols`/`rows`. A
// spectator pane adopts these and CSS-scales rather than resizing the shared
// line, so the field must reflect the real pty grid — not a spawn-time constant
// that drifts. The pure board.test.js can't reach this: the fields are read off
// a real node-pty (`s.pty.cols`/`rows`), so this spawns a REAL board on an
// isolated pipe and reads them back end to end.
//
// The pipe override must be set before lib.js is required (PIPE_BASE is read at
// module load). node --test runs each file in its own process, so it can't leak.
process.env.AGENT_RELAY_PIPE = `ar-listdims-test-${process.pid}`;

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const lib = require('./lib');

const rpc = m => lib.rpc(m, { autostart: false });

async function pollFor(fn, { timeout = 10000, interval = 200 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await new Promise(r => setTimeout(r, interval));
  }
}

test('list reply carries each live line\'s live PTY cols/rows (ADR-0005 point 1)', async t => {
  const child = spawn(process.execPath, [path.join(__dirname, 'board.js')], {
    stdio: 'ignore',
    env: process.env,
  });
  t.after(() => {
    try { child.kill(); } catch { /* already exited via shutdown */ }
    try { fs.unlinkSync(lib.secretPath()); } catch { /* best effort */ }
  });

  const cols = 97, rows = 41;   // non-default (createLine defaults 120x30)
  const a = await rpc({ cmd: 'new', open: false, name: 'sized', cols, rows });
  assert.strictEqual(a.ok, true, 'board spawned the sized line');

  const row = await pollFor(async () =>
    (await rpc({ cmd: 'list' })).lines.find(x => x.id === a.id));
  assert.ok(row, 'the sized line is listed');
  assert.strictEqual(row.cols, cols, 'list surfaces the line\'s live PTY cols');
  assert.strictEqual(row.rows, rows, 'list surfaces the line\'s live PTY rows');

  await rpc({ cmd: 'shutdown' });
});
