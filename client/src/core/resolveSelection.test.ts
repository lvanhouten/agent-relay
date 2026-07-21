import test from 'node:test';
import assert from 'node:assert';
import { resolveSelection } from './resolveSelection.ts';
import type { Session } from './types.ts';

const s = (id: string, status = 'running'): Session => ({
  id, name: `s-${id}`, shell: 'bash', cwd: '~', pid: 1, status, lastActive: 'just now',
});

test('the selected id present in the poll resolves to that session', () => {
  const list = [s('1'), s('2')];
  assert.strictEqual(resolveSelection(list, '2', null)?.id, '2');
});

test('a session that just exited is still in the poll and resolves as its tombstone', () => {
  const list = [s('1'), s('2', 'exited')];
  const got = resolveSelection(list, '2', s('2')); // cache still holds the live version
  assert.strictEqual(got?.status, 'exited');
});

test('a transiently-absent LIVE selection falls back to the cache (fresh create / kill-suppression gap)', () => {
  // selectedId points at a session not yet in the poll; the cache holds it.
  const cached = s('new');
  assert.strictEqual(resolveSelection([s('1')], 'new', cached), cached);
});

test('an evicted TOMBSTONE selection resolves to null, not the stale cache', () => {
  // Cached tombstone evicted from the poll (board ring) must resolve null — the frozen-ghost bug.
  const evicted = s('gone', 'exited');
  assert.strictEqual(resolveSelection([s('1'), s('2')], 'gone', evicted), null);
});

test('nothing selected resolves to null', () => {
  assert.strictEqual(resolveSelection([s('1')], null, null), null);
});

test('a cache whose id no longer matches the selected id is ignored', () => {
  // selection moved on; a leftover cache for a different id must not resurface.
  assert.strictEqual(resolveSelection([s('1')], '2', s('old')), null);
});

test('absent selection with no cache resolves to null', () => {
  assert.strictEqual(resolveSelection([s('1')], 'missing', null), null);
});
