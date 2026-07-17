'use strict';
// Integration guard for the `preview:true` list tail: a preview list carries
// each live line's rendered-screen bottom rows, and a plain list carries none.
// The pure board.test.js covers screenPreview's slicing/capping against a stub
// screen; this proves the real path end to end — a line's actual output, fed
// through its lazy VT emulator, surfaces in the list reply only when asked for.
//
// The pipe override must be set before lib.js is required (PIPE_BASE is read at
// module load). node --test runs each file in its own process, so it can't leak.
process.env.AGENT_RELAY_PIPE = `ar-listpreview-test-${process.pid}`;

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

test('list carries a rendered tail only when preview is requested', async t => {
  const child = spawn(process.execPath, [path.join(__dirname, 'board.js')], {
    stdio: 'ignore',
    env: process.env,
  });
  t.after(() => {
    try { child.kill(); } catch { /* already exited via shutdown */ }
    try { fs.unlinkSync(lib.secretPath()); } catch { /* best effort */ }
  });

  const MARKER = 'PREVIEWMARKER9F3';
  const a = await rpc({ cmd: 'new', open: false, name: 'previewed', run: `echo ${MARKER}` });
  assert.strictEqual(a.ok, true, 'board spawned the line');

  // Poll a preview list until the marker (typed command + its echo) has rendered
  // into the line's screen tail — the run feeder types asynchronously.
  const withPreview = await pollFor(async () => {
    const row = (await rpc({ cmd: 'list', preview: true })).lines.find(x => x.id === a.id);
    return row && Array.isArray(row.preview) && row.preview.join('\n').includes(MARKER) ? row : null;
  });
  assert.ok(withPreview, 'preview list surfaces the line\'s rendered tail');
  assert.ok(withPreview.preview.length <= 3, 'the tail is capped to PREVIEW_ROWS');

  // A plain list — the sb / MCP / cwd-resolver path — never carries the tail.
  const plain = (await rpc({ cmd: 'list' })).lines.find(x => x.id === a.id);
  assert.ok(plain, 'the line is still listed without preview');
  assert.strictEqual(plain.preview, undefined, 'a preview-less list warms nothing and returns no tail');

  await rpc({ cmd: 'shutdown' });
});
