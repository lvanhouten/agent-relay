// WS frame parsing — covers N4's residual: JSON.parse('null') and other
// valid-but-non-object frames must not reach a `.type` access that throws inside
// onmessage and freezes the terminal.
import test from 'node:test';
import assert from 'node:assert';
import { parseFrame, isValidDataPayload } from './wsFrame.js';

test('parseFrame: the literal "null" frame returns null, not a throwing value (N4)', () => {
  // Before the fix: JSON.parse('null') === null, then null.type threw.
  assert.strictEqual(parseFrame('null'), null);
});

test('parseFrame: primitive frames (number, string, bool) return null', () => {
  assert.strictEqual(parseFrame('42'), null);
  assert.strictEqual(parseFrame('"hi"'), null);
  assert.strictEqual(parseFrame('true'), null);
});

test('parseFrame: unparseable JSON returns null', () => {
  assert.strictEqual(parseFrame('{not json'), null);
  assert.strictEqual(parseFrame(''), null);
});

test('parseFrame: a well-formed object frame passes through', () => {
  assert.deepStrictEqual(parseFrame('{"type":"data","payload":"x"}'), { type: 'data', payload: 'x' });
  assert.deepStrictEqual(parseFrame('{"type":"exit","code":0}'), { type: 'exit', code: 0 });
});

test('parseFrame: an array is not a dispatchable message', () => {
  // Arrays are typeof "object"; a msg.type access is harmless (undefined) but this
  // is still not a valid frame. Current guard admits it (returns the array) — the
  // downstream `msg.type === ...` simply never matches, so no throw. Documented.
  assert.deepStrictEqual(parseFrame('[]'), []);
});

// isValidDataPayload — W4-new: parseFrame only guarantees the envelope shape,
// not a given type's payload shape. A 'data' frame's payload reaches
// term.write() directly, so anything but a string must be rejected.
test('isValidDataPayload: a string payload is valid', () => {
  assert.strictEqual(isValidDataPayload({ type: 'data', payload: 'x' }), true);
});

test('isValidDataPayload: a non-string payload is rejected', () => {
  assert.strictEqual(isValidDataPayload({ type: 'data', payload: { evil: true } }), false);
  assert.strictEqual(isValidDataPayload({ type: 'data', payload: 42 }), false);
  assert.strictEqual(isValidDataPayload({ type: 'data', payload: null }), false);
  assert.strictEqual(isValidDataPayload({ type: 'data' }), false);
});
