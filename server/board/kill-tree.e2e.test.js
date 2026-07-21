'use strict';
// Guards killLineTree's reap: useConptyDll:true takes node-pty's no-fork DLL kill path,
// which deletes node-pty's own console-wide process reaper (over-broad, but it swept up
// detached grandchildren like dev servers squatting a port). killLineTree replaces it with
// a scoped `taskkill /T` from the line's own shell pid; this proves a detached grandchild
// that survives the pseudo-console close is still gone after `end`.
//
// Windows-only (off-Windows killLineTree is just s.pty.kill()). The original board-wide-kill
// bug has no isolation repro (only the production console topology triggers it); this guards
// the provable half - scoped tree reap.
//
// AGENT_RELAY_PIPE must be set before lib.js is required (PIPE_BASE reads it at load); node
// --test isolates each file's process so it can't leak.
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
  // Shell runs this: launches a DETACHED, unref'd node loop (own process group, survives
  // console teardown), records its pid, and stays alive so cmd -> node(spawner) ->
  // node(grandchild) is intact at kill time. taskkill /T reaps the whole subtree; a bare
  // console close would not.
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

  // `run` has no delivery confirmation - poll the pid file the grandchild writes as proof it launched.
  assert.ok(await pollFor(() => fs.existsSync(pidFile)), 'grandchild launched and wrote its pid');
  grandPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  assert.ok(grandPid > 0 && isAlive(grandPid), 'detached grandchild is live before the kill');

  const e = await rpc({ cmd: 'end', id: line.id });
  assert.strictEqual(e.ok, true, 'end killed the line');

  const reaped = await pollFor(() => !isAlive(grandPid));
  assert.ok(reaped, 'the detached grandchild was reaped with its line, not orphaned');
});
