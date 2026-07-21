import test from 'node:test';
import assert from 'node:assert';
import { toggleView, canNotify, toggleAction } from './notifyGate.ts';

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

// toggleAction must track resolved state, not raw opt-in — else a lapsed permission's re-enable no-ops.
test('enabled + granted disables (notifications are actually live)', () => {
  assert.strictEqual(toggleAction(true, 'granted'), 'disable');
});

test('stale enabled + default permission re-requests, does not no-op', () => {
  assert.strictEqual(toggleAction(true, 'default'), 'request');
});

test('stale enabled + denied permission re-requests', () => {
  assert.strictEqual(toggleAction(true, 'denied'), 'request');
});

test('not enabled always requests, whatever the permission', () => {
  assert.strictEqual(toggleAction(false, 'granted'), 'request');
  assert.strictEqual(toggleAction(false, 'default'), 'request');
});
