import test from 'node:test';
import assert from 'node:assert';
import { shouldXtermConsumeKey } from './keyPassthrough.ts';

const evt = { code: 'Digit3' } as KeyboardEvent;

test('shouldXtermConsumeKey: no passthroughKeys -> always consumed (unchanged default)', () => {
  assert.strictEqual(shouldXtermConsumeKey(undefined, evt), true);
});

test('shouldXtermConsumeKey: passthroughKeys returns false for this event -> still consumed', () => {
  assert.strictEqual(shouldXtermConsumeKey(() => false, evt), true);
});

test('shouldXtermConsumeKey: passthroughKeys returns true for this event -> not consumed', () => {
  assert.strictEqual(shouldXtermConsumeKey(() => true, evt), false);
});
