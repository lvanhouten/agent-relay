import test from 'node:test';
import assert from 'node:assert';
import { wheelScrollLines, touchScrollLines, takeWholeLines } from './terminalScroll.ts';
import type { ScrollEnv } from './terminalScroll.ts';

const NORMAL_TRACKED: ScrollEnv = { bufferType: 'normal', mouseTracking: 'any', cellHeight: 20, rows: 24 };

test('wheelScrollLines: defers in the alternate screen (app owns it)', () => {
  assert.strictEqual(wheelScrollLines(120, 0, { ...NORMAL_TRACKED, bufferType: 'alternate' }), null);
});

test('wheelScrollLines: defers when the app has not grabbed the mouse', () => {
  assert.strictEqual(wheelScrollLines(120, 0, { ...NORMAL_TRACKED, mouseTracking: 'none' }), null);
});

test('wheelScrollLines: defers on a zero delta', () => {
  assert.strictEqual(wheelScrollLines(0, 0, NORMAL_TRACKED), null);
});

test('wheelScrollLines: pixel delta divides by cell height', () => {
  assert.strictEqual(wheelScrollLines(60, 0, NORMAL_TRACKED), 3);
  assert.strictEqual(wheelScrollLines(-40, 0, NORMAL_TRACKED), -2);
});

test('wheelScrollLines: line and page deltas', () => {
  assert.strictEqual(wheelScrollLines(2, 1, NORMAL_TRACKED), 2);       // DOM_DELTA_LINE
  assert.strictEqual(wheelScrollLines(1, 2, NORMAL_TRACKED), 24);      // DOM_DELTA_PAGE -> rows
});

test('touchScrollLines: normal buffer inverts the drag (finger down -> into history)', () => {
  assert.strictEqual(touchScrollLines(40, NORMAL_TRACKED), -2);   // dragged down 40px -> up 2 lines
  assert.strictEqual(touchScrollLines(-60, NORMAL_TRACKED), 3);   // dragged up -> down 3 lines
});

test('touchScrollLines: claimed even without mouse tracking (xterm 6 has no touch scroll)', () => {
  assert.strictEqual(touchScrollLines(40, { ...NORMAL_TRACKED, mouseTracking: 'none' }), -2);
});

test('touchScrollLines: defers in the alternate screen', () => {
  assert.strictEqual(touchScrollLines(40, { ...NORMAL_TRACKED, bufferType: 'alternate' }), null);
});

test('takeWholeLines: truncates toward zero and carries the remainder', () => {
  assert.deepStrictEqual(takeWholeLines(0, 0.6), { whole: 0, rest: 0.6 });
  const next = takeWholeLines(0.6, 0.6);
  assert.strictEqual(next.whole, 1);
  assert.ok(Math.abs(next.rest - 0.2) < 1e-9);
});

test('takeWholeLines: negative accumulation truncates toward zero', () => {
  const r = takeWholeLines(-0.5, -0.7);
  assert.strictEqual(r.whole, -1);
  assert.ok(Math.abs(r.rest - -0.2) < 1e-9);
});
