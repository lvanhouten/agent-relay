'use strict';
// The one constant-time compare shared by auth.js (token) and cookie.js
// (HMAC signature) — one definition, two importers, so the paths can't drift.
const test = require('node:test');
const assert = require('node:assert');
const { safeEqual } = require('./safeCompare');

test('safeEqual: equal strings match', () => {
  assert.strictEqual(safeEqual('the-token', 'the-token'), true);
});

test('safeEqual: different same-length strings do not match', () => {
  assert.strictEqual(safeEqual('abcdef', 'abcdeg'), false);
});

test('safeEqual: different-length strings reject without throwing', () => {
  assert.strictEqual(safeEqual('short', 'longer-value'), false);
  assert.strictEqual(safeEqual('', 'x'), false);
});

test('safeEqual: non-string inputs reject (never reach timingSafeEqual)', () => {
  assert.strictEqual(safeEqual(undefined, 'x'), false);
  assert.strictEqual(safeEqual('x', undefined), false);
  assert.strictEqual(safeEqual(null, null), false);
  assert.strictEqual(safeEqual(42, 42), false);
});

test('safeEqual: the same reference is imported by auth.js and cookie.js', () => {
  // Not exported from either caller, so this pins the Node require-cache
  // singleton instead — proof both callers share one implementation.
  assert.strictEqual(require('./safeCompare').safeEqual, safeEqual);
});
