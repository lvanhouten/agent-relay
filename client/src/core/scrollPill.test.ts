import test from 'node:test';
import assert from 'node:assert';
import { PILL_INIT, isAtBottom, onScroll, onLine } from './scrollPill.ts';

test('isAtBottom: equal or past baseY counts as pinned', () => {
  assert.strictEqual(isAtBottom(10, 10), true);
  assert.strictEqual(isAtBottom(11, 10), true);   // clamp-safety: never "above"
  assert.strictEqual(isAtBottom(9, 10), false);
});

test('onScroll: scrolling up detaches with a zeroed count', () => {
  const s = onScroll(PILL_INIT, 5, 10);
  assert.deepStrictEqual(s, { atBottom: false, newLines: 0 });
});

test('onScroll: re-reaching the bottom clears the missed-line count', () => {
  const detached = { atBottom: false, newLines: 7 };
  assert.deepStrictEqual(onScroll(detached, 10, 10), PILL_INIT);
});

test('onScroll: scrolling while already detached preserves the count', () => {
  const detached = { atBottom: false, newLines: 3 };
  // scrolled from row 5 to row 6, still above baseY 10
  assert.deepStrictEqual(onScroll(detached, 6, 10), detached);
});

test('onLine: lines arriving while pinned do not accumulate', () => {
  assert.deepStrictEqual(onLine(PILL_INIT), PILL_INIT);
});

test('onLine: lines arriving while detached increment the count', () => {
  let s = { atBottom: false, newLines: 0 };
  s = onLine(s);
  s = onLine(s);
  assert.deepStrictEqual(s, { atBottom: false, newLines: 2 });
});
