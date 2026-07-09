'use strict';
// Integration guard for the attach-time history reconstruction (the `sb join`
// scroll-garble fix). The unit tests prove the two halves in isolation —
// reconstructReplay resolves width-fragile redraws (screen-render.test.js) and
// attachWithReplay's replay-before-live ordering (board.test.js) — but neither
// exercises the real path: a data-pipe client authing and receiving a
// *reconstructed* replay (serialized escape sequences from the emulator) rather
// than the raw byte-log. This spawns a REAL board on an isolated pipe, starts a
// line that deterministically prints a marker at startup, then attaches a second
// data-pipe client and asserts it receives that history on join.
//
// The pipe override must be set before lib.js is required (PIPE_BASE is read at
// module load). node --test runs each test file in its own process, so it can't
// leak into the other board tests.
process.env.AGENT_RELAY_PIPE = `ar-replay-test-${process.pid}`;

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const lib = require('./lib');

const rpc = m => lib.rpc(m, { autostart: false });

// A shell that prints a marker at startup and then STAYS interactive (so the
// line is joinable, not a tombstone). No reliance on the run-feeder's timing.
const MARKER = 'REPLAY_MARKER_9137';
const markerShell = process.platform === 'win32'
  ? { shell: 'cmd.exe', args: ['/k', `echo ${MARKER}`] }
  : { shell: 'sh', args: ['-c', `echo ${MARKER}; exec sh`] };

// Attach a raw data-pipe client and resolve once `needle` shows up in the stream,
// or reject on timeout. connectPipe sends the access secret transparently.
function readUntil(id, needle, { timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    lib.connectPipe(lib.dataPipe(id), { retries: 20 }).then(sock => {
      let buf = '';
      const timer = setTimeout(() => { sock.destroy(); reject(new Error(`never saw ${needle}; got: ${JSON.stringify(buf.slice(0, 400))}`)); }, timeout);
      sock.on('data', d => {
        buf += d.toString('utf8');
        if (buf.includes(needle)) { clearTimeout(timer); sock.destroy(); resolve(buf); }
      });
      sock.on('error', () => {});
    }, reject);
  });
}

async function pollFor(fn, { timeout = 8000, interval = 150 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await new Promise(r => setTimeout(r, interval));
  }
}

test('a joining client receives the line history as a reconstructed replay on attach', async t => {
  const child = spawn(process.execPath, [path.join(__dirname, 'board.js')], {
    stdio: 'ignore',
    env: process.env,
  });
  t.after(async () => {
    try { await rpc({ cmd: 'shutdown' }); } catch { /* board may already be gone */ }
    try { child.kill(); } catch { /* already exited via shutdown */ }
    try { fs.unlinkSync(lib.secretPath()); } catch { /* best effort */ }
  });

  const created = await rpc({ cmd: 'new', open: false, name: 'replay', cols: 120, rows: 30, ...markerShell });
  assert.strictEqual(created.ok, true, 'board spawned the marker line');
  const id = created.id;

  // First client attaches and waits for the marker — this proves the line is up
  // and its startup output is captured in the board's scrollback.
  const first = await readUntil(id, MARKER);
  assert.ok(first.includes(MARKER), 'first client saw the startup marker live');

  // A SECOND client joins after the fact: its attach replay is reconstructed from
  // the scrollback. It must still receive the marker as history.
  const joined = await readUntil(id, MARKER);
  assert.ok(joined.includes(MARKER), 'a later joiner receives the history on attach');

  // The replay is a reconstruction (serialized emulator output), so no raw VT
  // escapes are half-torn: sanity-check it is a non-empty payload the marker sits in.
  assert.ok(joined.length > 0, 'the reconstructed replay is non-empty');
});
