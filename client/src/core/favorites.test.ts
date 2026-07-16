import test from 'node:test';
import assert from 'node:assert';
import {
  parseFavorites, serializeFavorites, addFavorite, removeFavorite, isFavorite, MAX_FAVORITES,
} from './favorites.ts';

test('parseFavorites: null / empty string yields an empty list', () => {
  assert.deepStrictEqual(parseFavorites(null), []);
  assert.deepStrictEqual(parseFavorites(''), []);
});

test('parseFavorites: unparseable JSON is swallowed, not thrown', () => {
  assert.deepStrictEqual(parseFavorites('{not json'), []);
});

test('parseFavorites: a non-array yields empty', () => {
  assert.deepStrictEqual(parseFavorites('{"path":"x"}'), []);
  assert.deepStrictEqual(parseFavorites('42'), []);
});

test('parseFavorites: non-string and blank entries are dropped', () => {
  const raw = JSON.stringify(['C:\\a', 1, null, '  ', 'C:\\b']);
  assert.deepStrictEqual(parseFavorites(raw), ['C:\\a', 'C:\\b']);
});

test('parseFavorites: dedupes by canonical form (trailing separator ignored)', () => {
  const raw = JSON.stringify(['C:\\a', 'C:\\a\\', 'C:\\a/']);
  assert.deepStrictEqual(parseFavorites(raw), ['C:\\a']);
});

test('serialize -> parse round-trips a clean list', () => {
  const list = ['C:\\a', '/home/x'];
  assert.deepStrictEqual(parseFavorites(serializeFavorites(list)), list);
});

test('isFavorite: matches ignoring a trailing separator, misses otherwise', () => {
  const list = ['C:\\dev\\agent-relay'];
  assert.ok(isFavorite(list, 'C:\\dev\\agent-relay'));
  assert.ok(isFavorite(list, 'C:\\dev\\agent-relay\\'));
  assert.ok(!isFavorite(list, 'C:\\dev\\other'));
});

test('addFavorite: appends a new path (stable order)', () => {
  assert.deepStrictEqual(addFavorite(['C:\\a'], 'C:\\b'), ['C:\\a', 'C:\\b']);
});

test('addFavorite: an already-pinned path is a no-op (returns the same list)', () => {
  const list = ['C:\\a'];
  assert.strictEqual(addFavorite(list, 'C:\\a\\'), list);
});

test('addFavorite: a blank path is a no-op', () => {
  const list = ['C:\\a'];
  assert.strictEqual(addFavorite(list, '   '), list);
});

test('addFavorite: stores the path trimmed', () => {
  assert.deepStrictEqual(addFavorite([], '  C:\\a  '), ['C:\\a']);
});

test('addFavorite: over the cap, the oldest entry drops from the front', () => {
  const full = Array.from({ length: MAX_FAVORITES }, (_, i) => `C:\\p${i}`);
  const next = addFavorite(full, 'C:\\new');
  assert.strictEqual(next.length, MAX_FAVORITES);
  assert.strictEqual(next[0], 'C:\\p1');
  assert.strictEqual(next[next.length - 1], 'C:\\new');
});

test('removeFavorite: drops the matching path, ignoring a trailing separator', () => {
  const list = ['C:\\a', 'C:\\b'];
  assert.deepStrictEqual(removeFavorite(list, 'C:\\a\\'), ['C:\\b']);
});

test('removeFavorite: a non-member leaves the list unchanged', () => {
  const list = ['C:\\a'];
  assert.deepStrictEqual(removeFavorite(list, 'C:\\z'), ['C:\\a']);
});
