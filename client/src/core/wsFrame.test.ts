// Non-object frames (e.g. parsed "null") must never reach a `.type` access, which would freeze onmessage.
import test from 'node:test';
import assert from 'node:assert';
import { parseFrame, isValidDataPayload, isValidExitCode } from './wsFrame.ts';

test('parseFrame: the literal "null" frame returns null, not a throwing value (N4)', () => {
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
  // Arrays pass the object check though invalid; harmless — msg.type is undefined on an array, never matches.
  assert.deepStrictEqual(parseFrame('[]'), []);
});

// A 'data' payload reaches term.write() directly, so parseFrame's shape check isn't enough — non-strings reject.
test('isValidDataPayload: a string payload is valid', () => {
  assert.strictEqual(isValidDataPayload({ type: 'data', payload: 'x' }), true);
});

test('isValidDataPayload: a non-string payload is rejected', () => {
  assert.strictEqual(isValidDataPayload({ type: 'data', payload: { evil: true } }), false);
  assert.strictEqual(isValidDataPayload({ type: 'data', payload: 42 }), false);
  assert.strictEqual(isValidDataPayload({ type: 'data', payload: null }), false);
  assert.strictEqual(isValidDataPayload({ type: 'data' }), false);
});

// server/src/ws.js only forwards number|null; anything else must reject so the consumer normalizes it, not garbage.
test('isValidExitCode: a numeric or null code is valid', () => {
  assert.strictEqual(isValidExitCode({ type: 'exit', code: 0 }), true);
  assert.strictEqual(isValidExitCode({ type: 'exit', code: 137 }), true);
  assert.strictEqual(isValidExitCode({ type: 'exit', code: null }), true);
});

test('isValidExitCode: a missing or non-numeric code is rejected', () => {
  assert.strictEqual(isValidExitCode({ type: 'exit' }), false);
  assert.strictEqual(isValidExitCode({ type: 'exit', code: '0' }), false);
  assert.strictEqual(isValidExitCode({ type: 'exit', code: { evil: true } }), false);
  assert.strictEqual(isValidExitCode({ type: 'exit', code: undefined }), false);
});
