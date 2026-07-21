'use strict';
// Guards the Claude-session marker scrub at daemon startup
// (_docs/issues/closed/2026-07-07-board-scrub-claude-session-env.md). The scrub runs in
// board.js's daemon-entry block before createLine spawns any Line, so a pure test can't
// reach it - this spawns a real board on an isolated pipe from a process carrying the
// markers (as if launched inside a Claude Code session) and dumps the Line's own env.
//
// One board per file, on purpose: two real-board e2e files sharing a pipe race on
// teardown (the second can EADDRINUSE against the first's not-yet-released pipe and its
// RPC lands on the dying board). Own file = own PIPE_BASE = no race.
//
// AGENT_RELAY_PIPE must be set before lib.js is required (PIPE_BASE reads it at load).
process.env.AGENT_RELAY_PIPE = `ar-markerscrub-test-${process.pid}`;

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

test('the daemon strips inherited Claude-session markers from every Line, keeping preferences', async t => {
  // Reproduces the incident: markers inherited by a Line make `claude` there think it's
  // a nested child and skip its transcript. Markers are seeded on this process before the
  // board spawns, so the repro is deterministic regardless of whether the test itself runs
  // in a session.
  const outFile = path.join(os.tmpdir(), `ar-scrubprobe-${process.pid}.txt`);
  try { fs.unlinkSync(outFile); } catch { /* fresh run */ }
  process.env.AR_SCRUBPROBE_OUT = outFile;

  const MARKERS = ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID',
    'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH'];
  for (const k of MARKERS) process.env[k] = `seed-${k}`;
  process.env.CLAUDE_EFFORT = 'seed-effort';   // a preference: must survive the scrub

  const child = spawn(process.execPath, [path.join(__dirname, 'board.js')], {
    stdio: 'ignore',
    env: process.env,   // board inherits the markers, exactly as it would in a session
  });
  t.after(() => {
    try { child.kill(); } catch { /* already exited via shutdown */ }
    try { fs.unlinkSync(lib.secretPath()); } catch { /* best effort */ }
    try { fs.unlinkSync(outFile); } catch { /* best effort */ }
    delete process.env.AR_SCRUBPROBE_OUT;
    for (const k of MARKERS) delete process.env[k];
    delete process.env.CLAUDE_EFFORT;
  });

  // Probe dumps each var (null when absent) as JSON, run as the line's process to read
  // exactly what createLine handed the pty.
  const probe = 'const k=["CLAUDECODE","CLAUDE_CODE_CHILD_SESSION","CLAUDE_CODE_SESSION_ID",'
    + '"CLAUDE_CODE_ENTRYPOINT","CLAUDE_CODE_EXECPATH","CLAUDE_EFFORT"];'
    + 'const o={};for(const x of k)o[x]=x in process.env?process.env[x]:null;'
    + 'require("fs").writeFileSync(process.env.AR_SCRUBPROBE_OUT,JSON.stringify(o))';
  const r = await rpc({ cmd: 'new', open: false, name: 'scrubprobe', shell: process.execPath, args: ['-e', probe] });
  assert.strictEqual(r.ok, true, 'board spawned the probe line');

  const written = await pollFor(() => (fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : null));
  assert.ok(written != null, 'the probe process wrote its env out');
  const env = JSON.parse(written);
  for (const k of MARKERS) {
    assert.strictEqual(env[k], null, `${k} was scrubbed before the Line was spawned`);
  }
  assert.strictEqual(env.CLAUDE_EFFORT, 'seed-effort', 'a deliberate preference survives the scrub (not a CLAUDE_* glob)');

  await rpc({ cmd: 'shutdown' });
});
