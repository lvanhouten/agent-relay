import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectPane, removePane, prunePanes, focusedPane, paneRows } from './gridPanes.ts';

test('injectPane appends and is idempotent, preserving order', () => {
  assert.deepEqual(injectPane([], 'a'), ['a']);
  assert.deepEqual(injectPane(['a'], 'b'), ['a', 'b']);
  const same = ['a', 'b'];
  assert.equal(injectPane(same, 'a'), same, 're-inject returns the same array (no churn)');
});

test('removePane drops the id and is safe when absent', () => {
  assert.deepEqual(removePane(['a', 'b', 'c'], 'b'), ['a', 'c']);
  assert.deepEqual(removePane(['a'], 'x'), ['a']);
});

test('prunePanes keeps only ids whose session is still live', () => {
  assert.deepEqual(prunePanes(['a', 'b', 'c'], new Set(['a', 'c'])), ['a', 'c']);
  assert.deepEqual(prunePanes(['a'], new Set()), []);
});

test('focusedPane: selected id when in grid, else first pane, null when empty', () => {
  assert.equal(focusedPane([], 's'), null);
  assert.equal(focusedPane(['a', 'b'], 'b'), 'b', 'selected pane keeps focus');
  assert.equal(focusedPane(['a', 'b'], 'zzz'), 'a', 'selection outside the grid falls to the first pane');
  assert.equal(focusedPane(['a', 'b'], null), 'a', 'no selection falls to the first pane');
});

test('paneRows arranges ids into balanced, roughly-square rows', () => {
  assert.deepEqual(paneRows([]), []);
  assert.deepEqual(paneRows(['a']), [['a']]);
  assert.deepEqual(paneRows(['a', 'b']), [['a', 'b']]);
  assert.deepEqual(paneRows(['a', 'b', 'c']), [['a', 'b'], ['c']]);
  assert.deepEqual(paneRows(['a', 'b', 'c', 'd']), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(paneRows(['a', 'b', 'c', 'd', 'e']), [['a', 'b', 'c'], ['d', 'e']]);
  assert.deepEqual(paneRows(['a', 'b', 'c', 'd', 'e', 'f']), [['a', 'b', 'c'], ['d', 'e', 'f']]);
});
