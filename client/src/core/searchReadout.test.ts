import test from 'node:test';
import assert from 'node:assert';
import { searchReadout } from './searchReadout.ts';

test('matches render 1-based position over count', () => {
  assert.strictEqual(searchReadout('foo', { resultIndex: 0, resultCount: 5 }), '1/5');
  assert.strictEqual(searchReadout('foo', { resultIndex: 4, resultCount: 5 }), '5/5');
});

test('-1 means "not computed yet" and renders nothing — distinct from a genuine 0', () => {
  assert.strictEqual(searchReadout('foo', { resultIndex: -1, resultCount: -1 }), '');
  assert.strictEqual(searchReadout('foo', { resultIndex: -1, resultCount: 0 }), '0/0');
});

test('no query -> nothing, even with a zero count lingering from a cleared search', () => {
  assert.strictEqual(searchReadout('', { resultIndex: -1, resultCount: 0 }), '');
  assert.strictEqual(searchReadout('', { resultIndex: -1, resultCount: -1 }), '');
});
