import test from 'node:test';
import assert from 'node:assert';
import { jumpIndexFromKey } from './jumpKeys.ts';

// Minimal event shape the predicate needs; unspecified modifiers default to
// the "not held" / "not a repeat" case so each test only states what matters.
const key = (overrides: Partial<{
  altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean;
  code: string; key: string; repeat: boolean;
}> = {}) => ({
  altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
  code: '', key: '', repeat: false,
  ...overrides,
});

test('Alt+1 yields 1', () => {
  assert.strictEqual(jumpIndexFromKey(key({ altKey: true, code: 'Digit1', key: '1' })), 1);
});

test('Alt+9 yields 9', () => {
  assert.strictEqual(jumpIndexFromKey(key({ altKey: true, code: 'Digit9', key: '9' })), 9);
});

test('Alt+0 yields null (0 is not a jump target)', () => {
  assert.strictEqual(jumpIndexFromKey(key({ altKey: true, code: 'Digit0', key: '0' })), null);
});

test('Alt+letter yields null', () => {
  assert.strictEqual(jumpIndexFromKey(key({ altKey: true, code: 'KeyA', key: 'a' })), null);
});

test('a bare digit (no Alt) yields null', () => {
  assert.strictEqual(jumpIndexFromKey(key({ code: 'Digit1', key: '1' })), null);
});

test('Ctrl+digit yields null', () => {
  assert.strictEqual(jumpIndexFromKey(key({ ctrlKey: true, code: 'Digit1', key: '1' })), null);
});

test('Ctrl+Alt+digit yields null', () => {
  assert.strictEqual(jumpIndexFromKey(key({ altKey: true, ctrlKey: true, code: 'Digit1', key: '1' })), null);
});

test('Alt+Shift+digit yields null', () => {
  assert.strictEqual(jumpIndexFromKey(key({ altKey: true, shiftKey: true, code: 'Digit1', key: '1' })), null);
});

test('Meta+Alt+digit yields null', () => {
  assert.strictEqual(jumpIndexFromKey(key({ altKey: true, metaKey: true, code: 'Digit1', key: '1' })), null);
});

test('a key-repeat of an otherwise-matching chord yields null', () => {
  assert.strictEqual(jumpIndexFromKey(key({ altKey: true, code: 'Digit3', key: '3', repeat: true })), null);
});
