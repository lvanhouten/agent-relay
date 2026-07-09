import test from 'node:test';
import assert from 'node:assert';
import { toggleView, canNotify } from './notifyGate.ts';

test('unsupported platform overrides everything else', () => {
  assert.strictEqual(toggleView(false, true, 'granted'), 'unsupported');
  assert.strictEqual(canNotify(false, true, 'granted'), false);
});

test('denied permission reads as blocked regardless of the opt-in flag', () => {
  assert.strictEqual(toggleView(true, true, 'denied'), 'blocked');
  assert.strictEqual(toggleView(true, false, 'denied'), 'blocked');
});

test('enabled + granted is on and fires', () => {
  assert.strictEqual(toggleView(true, true, 'granted'), 'on');
  assert.strictEqual(canNotify(true, true, 'granted'), true);
});

test('opt-in with permission still default is off and does not fire', () => {
  assert.strictEqual(toggleView(true, true, 'default'), 'off');
  assert.strictEqual(canNotify(true, true, 'default'), false);
});

test('granted but not opted in is off and does not fire', () => {
  assert.strictEqual(toggleView(true, false, 'granted'), 'off');
  assert.strictEqual(canNotify(true, false, 'granted'), false);
});
