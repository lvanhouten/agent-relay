'use strict';
// Guards the `screen` control command: the live-line path builds a real @xterm/headless
// emulator from a line's scrollback + live feed, and resize is keyed by a persistent
// control socket - neither reachable from a unit test. This spawns a real board and drives
// a real line through seeded read, live-feed read, resize tracking, and the two distinct
// failure replies (never-existed vs exited).
//
// AGENT_RELAY_PIPE must be set before lib.js is required (PIPE_BASE reads it at load);
// every RPC below goes through this isolated namespace - a bare RPC would hit the
// production board.
process.env.AGENT_RELAY_PIPE = `ar-screen-test-${process.pid}`;

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const lib = require('./lib');

const rpc = m => lib.rpc(m, { autostart: false });

async function pollFor(fn, { timeout = 10000, interval = 150 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await new Promise(r => setTimeout(r, interval));
  }
}

// Highest TICK<n> on the grid (older ticks scroll off top); -1 when none present yet.
function maxTick(grid) {
  let max = -1;
  for (const m of grid.matchAll(/TICK(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

const exitShell = process.platform === 'win32'
  ? { shell: 'cmd.exe', args: ['/c', 'exit 3'] }
  : { shell: 'sh', args: ['-c', 'exit 3'] };

test('screen command: seeded live read, live-feed freshness, resize tracking, and two distinct failure replies', async t => {
  const child = spawn(process.execPath, [path.join(__dirname, 'board.js')], {
    stdio: 'ignore',
    env: process.env,
  });
  t.after(() => {
    try { child.kill(); } catch { /* already exited via shutdown */ }
    try { fs.unlinkSync(lib.secretPath()); } catch { /* best effort */ }
  });

  const none = await rpc({ cmd: 'screen', id: 'no-such-line' });
  assert.strictEqual(none.ok, false, 'never-existed line is not ok');
  assert.strictEqual(none.ended, false, 'never-existed is not an exit');

  // A live line as node itself (no interactive shell / run-feeder timing):
  // emits an incrementing TICK marker so a later read can be proven newer.
  const probe = "process.stdout.write('BOOT\\r\\n');let n=0;setInterval(()=>process.stdout.write('TICK'+(++n)+'\\r\\n'),120)";
  const r = await rpc({ cmd: 'new', open: false, name: 'screenprobe', shell: process.execPath, args: ['-e', probe] });
  assert.strictEqual(r.ok, true, 'board spawned the screen probe line');

  // Lazy-init seeds from scrollback, so already-produced output appears immediately,
  // at the line's PTY defaults.
  const first = await pollFor(async () => {
    const s = await rpc({ cmd: 'screen', id: r.id });
    return (s.ok && maxTick(s.grid) >= 0) ? s : null;
  });
  assert.ok(first, 'first screen read returned a grid with the line output');
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.boot, r.boot, 'the screen reply carries the board boot nonce');
  assert.strictEqual(first.cols, 120, 'grid width matches the line PTY (createLine default cols)');
  assert.strictEqual(first.rows, 30, 'grid height matches the line PTY (createLine default rows)');
  assert.ok(first.cursor && Number.isInteger(first.cursor.row) && Number.isInteger(first.cursor.col),
    'cursor is reported as integer row/col');
  const firstMax = maxTick(first.grid);

  const later = await pollFor(async () => {
    const s = await rpc({ cmd: 'screen', id: r.id });
    return (s.ok && maxTick(s.grid) > firstMax) ? s : null;
  });
  assert.ok(later, 'a later read shows newer output — the live feed keeps the emulator current');

  // Resize is keyed by the sending control socket; a one-shot rpc() socket closing
  // would revert it, so hold one open across the read.
  const ctl = await lib.connectControl({ autostart: false });
  ctl.on('data', () => {});   // drain; resize sends no reply
  ctl.write(JSON.stringify({ cmd: 'resize', id: r.id, cols: 40, rows: 12 }) + '\n');
  const resized = await pollFor(async () => {
    const s = await rpc({ cmd: 'screen', id: r.id });
    return (s.ok && s.cols === 40 && s.rows === 12) ? s : null;
  });
  try { ctl.end(); } catch { /* ignore */ }
  assert.ok(resized, 'after a PTY resize the grid dims match the new size');
  const widest = Math.max(0, ...resized.grid.split('\n').map(l => l.length));
  assert.ok(widest <= 40, 'the grid is laid out to the new width — no row exceeds it');

  const dead = await rpc({ cmd: 'new', open: false, name: 'diesoon', shell: exitShell.shell, args: exitShell.args });
  assert.strictEqual(dead.ok, true, 'board spawned the self-exiting line');
  assert.ok(await pollFor(async () =>
    ((await rpc({ cmd: 'list' })).ended || []).find(x => x.id === dead.id)),
    'the self-exiting line left a tombstone');
  const exited = await rpc({ cmd: 'screen', id: dead.id });
  assert.strictEqual(exited.ok, false, 'an exited line is not ok');
  assert.strictEqual(exited.ended, true, 'an exited line reports ended:true');
  assert.strictEqual(exited.exitCode, 3, 'the exit code rides the failure reply');
  assert.notDeepStrictEqual(
    { ok: exited.ok, ended: exited.ended },
    { ok: none.ok, ended: none.ended },
    'exited and never-existed are distinguishable by `ended`');

  await rpc({ cmd: 'shutdown' });
});
