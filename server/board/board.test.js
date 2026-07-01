'use strict';
// Pane-spawn decision + RPC-reply signal tests. Covers N7's residual / new-N1:
// openPane's refusal must be visible to the caller (paneOpened in the reply), not
// just logged. Uses the pure helpers so no pty/process is launched.
const test = require('node:test');
const assert = require('node:assert');
const { paneSpawnDecision, openPane, handle } = require('./board');

test('paneSpawnDecision: a standalone {cmd} arg is spawnable', () => {
  const d = paneSpawnDecision({ file: 'wezterm', args: ['cli', 'spawn', '--', '{cmd}'] });
  assert.strictEqual(d.standalone, true);
  assert.strictEqual(d.embedded, false);
});

test('paneSpawnDecision: {cmd} embedded in a larger string is refused (N7)', () => {
  // SWITCHBOARD_TERM="sh -c '{cmd}'" -> ["sh","-c","'{cmd}'"]
  const d = paneSpawnDecision({ file: 'sh', args: ['-c', "'{cmd}'"] });
  assert.strictEqual(d.standalone, false);
  assert.strictEqual(d.embedded, true);
});

test('paneSpawnDecision: no {cmd} token at all is refused', () => {
  const d = paneSpawnDecision({ file: 'sh', args: ['-c', 'echo hi'] });
  assert.strictEqual(d.standalone, false);
  assert.strictEqual(d.embedded, false);
});

test('openPane: returns false (no process) when the recipe is refused (new-N1)', () => {
  const opened = openPane('99', { file: 'sh', args: ['-c', "'{cmd}'"] });
  assert.strictEqual(opened, false);
});

// handle('join') on a nonexistent line never touches a pty — safe to exercise the
// reply-building. paneOpened must be present so the caller can tell.
function capture() {
  const chunks = [];
  return { sock: { write: s => chunks.push(s) }, reply: () => JSON.parse(chunks.join('')) };
}

test('join reply for a missing line reports ok:false and paneOpened:null (new-N1)', () => {
  const c = capture();
  handle({ cmd: 'join', id: 'no-such-line' }, c.sock);
  const r = c.reply();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.paneOpened, null, 'no pane attempted for a missing line');
  assert.ok('paneOpened' in r, 'the field is present so callers can branch on it');
});
