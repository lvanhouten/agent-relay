'use strict';
// Integration guard for the killLineTree reap (the P1 "ending one line kills the
// whole board" fix). Lines spawn with useConptyDll:true so node-pty's kill takes
// the no-fork DLL branch — which deletes node-pty's own console-wide process
// reaper. That reaper, over-broad as it was, DID sweep up detached grandchildren
// (dev servers squatting a port); killLineTree replaces it with a scoped
// `taskkill /T` from the line's own shell pid. This proves the replacement
// actually reaps: a detached grandchild that SURVIVES the pseudo-console close
// must still be gone after `end`. Remove the taskkill and this fails — the
// grandchild, detached from the console, outlives the kill.
//
// Windows-only: the reaper, the flash, and taskkill are all Windows-specific;
// off Windows killLineTree is just s.pty.kill(). The suicide itself has no
// isolation repro (only the production console topology triggers it — see the
// issue doc), so this guards the mechanism's provable half: scoped tree reap.
//
// Pipe override before requiring lib.js (PIPE_BASE is read at load); node --test
// isolates each file's process so it can't leak.
process.env.AGENT_RELAY_PIPE = `ar-killtree-test-${process.pid}`;

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

// signal-0 existence probe: no-op that throws ESRCH when the pid is gone.
function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }  // EPERM = exists but not ours; still alive
}

test('killLineTree reaps a detached descendant that outlives the console close', { skip: process.platform !== 'win32' && 'Windows-only reaper' }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-killtree-'));
  const pidFile = path.join(tmp, 'grand.pid');
  const spawner = path.join(tmp, 'spawner.js');
  // The line's shell runs this: it launches a DETACHED, unref'd node loop (its own
  // process group — survives the console tearing down), records its pid, then
  // stays alive itself so the tree cmd -> node(spawner) -> node(grandchild) is
  // fully intact at kill time. taskkill /T from the shell pid reaps the whole
  // subtree; a bare pseudo-console close would leave the detached grandchild.
  fs.writeFileSync(spawner, [
    "const { spawn } = require('child_process');",
    "const fs = require('fs');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { detached: true, stdio: 'ignore' });",
    "child.unref();",
    "fs.writeFileSync(process.argv[2], String(child.pid));",
    "setInterval(() => {}, 1e9);",
    '',
  ].join('\n'));

  let grandPid = null;
  const child = spawn(process.execPath, [path.join(__dirname, 'board.js')], {
    stdio: 'ignore',
    env: process.env,
  });
  t.after(async () => {
    if (grandPid && isAlive(grandPid)) { try { process.kill(grandPid); } catch { /* raced */ } }
    try { await rpc({ cmd: 'shutdown' }); } catch { /* board may be down */ }
    try { child.kill(); } catch { /* already exited */ }
    try { fs.unlinkSync(lib.secretPath()); } catch { /* best effort */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  const line = await rpc({
    cmd: 'new', open: false, name: 'reap-victim', shell: 'cmd.exe',
    run: `node "${spawner}" "${pidFile}"`,
  });
  assert.strictEqual(line.ok, true, 'board spawned the line');

  // The run command has no delivery confirmation (see switchboard notes) — poll
  // the pid file the grandchild writes as the proof it actually launched.
  assert.ok(await pollFor(() => fs.existsSync(pidFile)), 'grandchild launched and wrote its pid');
  grandPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  assert.ok(grandPid > 0 && isAlive(grandPid), 'detached grandchild is live before the kill');

  const e = await rpc({ cmd: 'end', id: line.id });
  assert.strictEqual(e.ok, true, 'end killed the line');

  const reaped = await pollFor(() => !isAlive(grandPid));
  assert.ok(reaped, 'the detached grandchild was reaped with its line, not orphaned');
});
