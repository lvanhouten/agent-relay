'use strict';
// Only parseNewArgs (the CLI's flag translation) is untested elsewhere - the
// open:false spawn path itself is covered by tombstone.e2e.test.js and web session create.
const test = require('node:test');
const assert = require('node:assert');
const { parseNewArgs } = require('./sb');

test('bare `new` — no shell, no run, tab (not here)', () => {
  assert.deepStrictEqual(parseNewArgs([]), { shell: undefined, run: undefined, here: false });
});

test('leading token is the shell', () => {
  assert.deepStrictEqual(parseNewArgs(['bash']), { shell: 'bash', run: undefined, here: false });
});

test('--run / -r captures the next token', () => {
  assert.strictEqual(parseNewArgs(['--run', 'claude']).run, 'claude');
  assert.strictEqual(parseNewArgs(['-r', 'claude']).run, 'claude');
});

test('--here and --inline both set here', () => {
  assert.strictEqual(parseNewArgs(['--here']).here, true);
  assert.strictEqual(parseNewArgs(['--inline']).here, true);
});

test('shell + run + here compose, order-independent', () => {
  const a = parseNewArgs(['bash', '--run', 'claude', '--here']);
  const b = parseNewArgs(['--here', '--run', 'claude', 'bash']);
  const expected = { shell: 'bash', run: 'claude', here: true };
  assert.deepStrictEqual(a, expected);
  assert.deepStrictEqual(b, expected);
});

test('a flag is never mistaken for the shell', () => {
  assert.strictEqual(parseNewArgs(['--here']).shell, undefined);
  assert.strictEqual(parseNewArgs(['--run', 'claude']).shell, undefined);
});

test('first non-flag wins the shell slot; later bare tokens are ignored', () => {
  assert.strictEqual(parseNewArgs(['bash', 'zsh']).shell, 'bash');
});
