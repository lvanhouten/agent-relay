import test from 'node:test';
import assert from 'node:assert';
import { capsFor, isScaled } from './terminalMode.ts';

test('interactive owns both capabilities — it is the only mode that sizes the line', () => {
  assert.deepStrictEqual(capsFor('interactive'), { input: true, sizing: true });
});

test('follow types without sizing — a focused grid pane must never reshape a shared line', () => {
  assert.deepStrictEqual(capsFor('follow'), { input: true, sizing: false });
});

test('spectator holds neither capability', () => {
  assert.deepStrictEqual(capsFor('spectator'), { input: false, sizing: false });
});

test('no grid mode owns sizing, so focusing a pane cannot clamp the line', () => {
  // The regression this split exists to prevent: the focused pane used to fit
  // its cell and clamp the PTY to it, and the board keeps the last applied size
  // when a pane leaves the clamp, so the line stayed stuck at that shape.
  for (const mode of ['follow', 'spectator'] as const) {
    assert.strictEqual(capsFor(mode).sizing, false, `${mode} must not own sizing`);
  }
});

test('an unknown mode degrades to the most restrictive capabilities', () => {
  // @ts-expect-error deliberately outside the union — an unrecognized mode must
  // not fall through to a permissive default.
  assert.deepStrictEqual(capsFor('bogus'), { input: false, sizing: false });
});

test('isScaled follows sizing, not input — a focused pane still adopts and scales', () => {
  assert.strictEqual(isScaled('interactive'), false);
  assert.strictEqual(isScaled('follow'), true);
  assert.strictEqual(isScaled('spectator'), true);
});
