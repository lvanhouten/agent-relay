'use strict';
// Integration guard for the killed-vs-exited `reason` invariant. The pure registry
// tests in board.test.js inject tombstones by hand, so they can't catch a
// regression in the path that PRODUCES one: createLine -> onExit, and the `end`
// handler's set-endReason-BEFORE-kill ordering (onExit fires async and reads
// it). A refactor that reorders those lines would silently relabel every
// operator kill as a crash with nothing failing — so this spawns a REAL board
// daemon on an isolated pipe and drives both exit paths end to end.
//
// The pipe override must be set before lib.js is required (PIPE_BASE is read at
// module load). node --test runs each test file in its own process, so this
// can't leak into board.test.js / lib.test.js.
process.env.AGENT_RELAY_PIPE = `ar-tombstone-test-${process.pid}`;

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const lib = require('./lib');

const rpc = m => lib.rpc(m, { autostart: false });

// Poll until fn() resolves truthy, or time runs out (the board's pty exits are
// async — there is no event to await from outside, only `list`).
async function pollFor(fn, { timeout = 10000, interval = 200 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await new Promise(r => setTimeout(r, interval));
  }
}

// A shell invocation that exits on its own with code 3 (the "natural exit").
const exitShell = process.platform === 'win32'
  ? { shell: 'cmd.exe', args: ['/c', 'exit 3'] }
  : { shell: 'sh', args: ['-c', 'exit 3'] };

test('tombstone reason invariant: natural exit records `exited`, end-command records `killed`', async t => {
  const child = spawn(process.execPath, [path.join(__dirname, 'board.js')], {
    stdio: 'ignore',
    env: process.env,
  });
  t.after(() => {
    try { child.kill(); } catch { /* already exited via shutdown */ }
    try { fs.unlinkSync(lib.secretPath()); } catch { /* best effort */ }
  });

  // Path 1 — the process exits on its own: reason must be the `|| 'exited'`
  // default, carrying the real exit code.
  const a = await rpc({ cmd: 'new', open: false, name: 'natural', ...exitShell });
  assert.strictEqual(a.ok, true, 'board spawned the self-exiting line');
  const tombA = await pollFor(async () =>
    ((await rpc({ cmd: 'list' })).ended || []).find(x => x.id === a.id));
  assert.ok(tombA, 'the self-exiting line left a tombstone');
  assert.strictEqual(tombA.reason, 'exited', 'a natural death is not labeled an operator kill');
  assert.strictEqual(tombA.exitCode, 3, 'the tombstone carries the real exit code');

  // Path 2 — an operator kill via `end`: endReason must be set before the
  // signal, so the async onExit sees it and records `killed`.
  const b = await rpc({ cmd: 'new', open: false, name: 'victim' });
  assert.strictEqual(b.ok, true, 'board spawned the victim line');
  // Wait until the shell is actually up (listed) before killing it.
  assert.ok(await pollFor(async () =>
    (await rpc({ cmd: 'list' })).lines.some(x => x.id === b.id)), 'victim line is live');
  const e = await rpc({ cmd: 'end', id: b.id });
  assert.strictEqual(e.ok, true);
  const tombB = await pollFor(async () =>
    ((await rpc({ cmd: 'list' })).ended || []).find(x => x.id === b.id));
  assert.ok(tombB, 'the killed line left a tombstone');
  assert.strictEqual(tombB.reason, 'killed', 'an end-command kill is not labeled a natural exit');

  await rpc({ cmd: 'shutdown' });
});
