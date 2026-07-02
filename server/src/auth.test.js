'use strict';
// Token-policy tests. resolveToken is pure over an env object, so the three
// shapes (opt-out / pinned / generated) are pinned here without mutating
// process.env; checkToken takes the token as an injectable second parameter for
// the same reason.
const test = require('node:test');
const assert = require('node:assert');
const { resolveToken, checkToken } = require('./auth');

test('resolveToken: AR_NO_AUTH=1 disables auth explicitly', () => {
  assert.deepStrictEqual(resolveToken({ AR_NO_AUTH: '1' }), { token: null, generated: false });
});

test('resolveToken: AR_TOKEN pins a stable token', () => {
  assert.deepStrictEqual(resolveToken({ AR_TOKEN: 'pinned' }), { token: 'pinned', generated: false });
});

test('resolveToken: unset env generates a fresh per-run token, not an open relay', () => {
  const a = resolveToken({});
  const b = resolveToken({});
  assert.strictEqual(a.generated, true);
  assert.ok(typeof a.token === 'string' && a.token.length >= 32, 'token must have real entropy');
  assert.notStrictEqual(a.token, b.token, 'each run gets its own token');
});

test('checkToken: matches only the exact token', () => {
  assert.strictEqual(checkToken('secret', 'secret'), true);
  assert.strictEqual(checkToken('wrong', 'secret'), false);
  assert.strictEqual(checkToken('', 'secret'), false);
  assert.strictEqual(checkToken(undefined, 'secret'), false);
});

test('checkToken: passes everything when auth is disabled (token null)', () => {
  assert.strictEqual(checkToken(undefined, null), true);
  assert.strictEqual(checkToken('anything', null), true);
});
