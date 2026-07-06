'use strict';
// Integration guard for the AGENT_RELAY_SESSION env injection (the precise half
// of the line-id bridge, _docs/issues/2026-07-06-hook-session-id-bridge.md). The
// env merge lives inside createLine's pty.spawn call, which isn't exported and
// hard-requires node-pty, so a pure unit test can't reach it. This spawns a REAL
// board on an isolated pipe and, as the line's own process, runs `node -e` under
// the injected env — writing $AGENT_RELAY_SESSION to a file we then compare
// against the board's reported line id. If the merge regresses (var dropped or
// misnamed), the file reads 'MISSING' or the wrong id and this fails.
//
// The pipe override must be set before lib.js is required (PIPE_BASE is read at
// module load). node --test runs each test file in its own process, so this
// can't leak into the other board tests.
process.env.AGENT_RELAY_PIPE = `ar-envinject-test-${process.pid}`;

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
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

test('createLine injects AGENT_RELAY_SESSION=<line id> into the spawned process env', async t => {
  // The probe reads the injected var and writes it out; the path is passed by
  // env (not embedded in the script) so a Windows backslash path needs no
  // escaping. Set on process.env BEFORE the board child spawns so it propagates
  // board -> createLine's env merge -> the line's process.
  const outFile = path.join(os.tmpdir(), `ar-envprobe-${process.pid}.txt`);
  try { fs.unlinkSync(outFile); } catch { /* fresh run */ }
  process.env.AR_ENVPROBE_OUT = outFile;

  const child = spawn(process.execPath, [path.join(__dirname, 'board.js')], {
    stdio: 'ignore',
    env: process.env,
  });
  t.after(() => {
    try { child.kill(); } catch { /* already exited via shutdown */ }
    try { fs.unlinkSync(lib.secretPath()); } catch { /* best effort */ }
    try { fs.unlinkSync(outFile); } catch { /* best effort */ }
    delete process.env.AR_ENVPROBE_OUT;
  });

  // Spawn node itself AS the line's process (shell + args), so it runs directly
  // under the injected pty env — no interactive shell, PATH lookup, or run-feeder
  // timing in the loop.
  const probe = 'require("fs").writeFileSync(process.env.AR_ENVPROBE_OUT, process.env.AGENT_RELAY_SESSION || "MISSING")';
  const r = await rpc({ cmd: 'new', open: false, name: 'envprobe', shell: process.execPath, args: ['-e', probe] });
  assert.strictEqual(r.ok, true, 'board spawned the probe line');

  const written = await pollFor(() => (fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : null));
  assert.ok(written != null, 'the probe process wrote its env var out');
  assert.strictEqual(written, r.id, 'AGENT_RELAY_SESSION carries the board line id, not MISSING or a stale value');

  await rpc({ cmd: 'shutdown' });
});
