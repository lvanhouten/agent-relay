'use strict';
// Integration guard for the Claude-session marker scrub at daemon startup
// (_docs/issues/2026-07-07-board-scrub-claude-session-env.md). The scrub runs in
// board.js's daemon-entry block and cleans process.env before createLine spawns
// any Line, so a pure test can't reach it — this spawns a REAL board on an
// isolated pipe from a process that carries the markers (i.e. as if launched from
// inside a Claude Code session) and, as the Line's own process, dumps its env.
//
// This lives in its OWN file (not alongside env-injection.e2e.test.js) on purpose:
// node --test runs each file in its own process, so PIPE_BASE below is unique per
// file, and each e2e file spawns exactly ONE board. Two real-board tests sharing a
// module-level pipe race on teardown — the second board can hit EADDRINUSE against
// the first's not-yet-released pipe and exit as "already running", making the RPC
// land on the dying board ("closed the connection before replying"). One board per
// file sidesteps that entirely.
//
// The pipe override must be set before lib.js is required (PIPE_BASE is read at
// module load).
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
  // Reproduces the incident: a board launched from a process that carries the
  // Claude-session identity markers (i.e. from inside a Claude Code session) must
  // NOT pass them to its Lines, or a `claude` in a Line treats itself as a nested
  // child and writes no transcript. Seed the markers on THIS process's env before
  // the board child spawns, so the reproduction is deterministic whether or not the
  // test itself runs in a session.
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

  // The probe dumps each var (null when absent) as JSON, run directly as the line's
  // process so it reads the exact env createLine handed the pty.
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
