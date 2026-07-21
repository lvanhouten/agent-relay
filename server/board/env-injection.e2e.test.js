'use strict';
// Guards AGENT_RELAY_SESSION injection (session-id bridge,
// _docs/issues/closed/2026-07-06-hook-session-id-bridge.md). createLine's pty.spawn env
// merge isn't exported and hard-requires node-pty, so this spawns a real board on an
// isolated pipe and diffs the injected var against the reported line id.
//
// AGENT_RELAY_PIPE must be set before lib.js is required (PIPE_BASE reads it at load) -
// node --test runs each file in its own process, so this can't leak into other board tests.
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
  // Path passed via env (not embedded in the script) to dodge Windows backslash escaping;
  // must be set before the board child spawns so it flows through createLine's env merge.
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

  // Node is spawned directly as the line's shell+args - runs under the injected pty env
  // with no interactive shell, PATH lookup, or run-feeder timing.
  const probe = 'require("fs").writeFileSync(process.env.AR_ENVPROBE_OUT, process.env.AGENT_RELAY_SESSION || "MISSING")';
  const r = await rpc({ cmd: 'new', open: false, name: 'envprobe', shell: process.execPath, args: ['-e', probe] });
  assert.strictEqual(r.ok, true, 'board spawned the probe line');

  const written = await pollFor(() => (fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : null));
  assert.ok(written != null, 'the probe process wrote its env var out');
  assert.strictEqual(written, r.id, 'AGENT_RELAY_SESSION carries the board line id, not MISSING or a stale value');

  await rpc({ cmd: 'shutdown' });
});
