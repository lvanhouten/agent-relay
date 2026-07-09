import test from 'node:test';
import assert from 'node:assert';
import { notifyTransitions } from './notifyRules.ts';
import type { Session } from './types.ts';

const session = (id: string, status: string, name = `s-${id}`): Session => ({
  id, name, shell: 'bash', cwd: '~', pid: 1, status, lastActive: 'just now',
});

test('entering needs-input from another status emits a spec', () => {
  const prev = [session('1', 'running')];
  const next = [session('1', 'needs-input')];
  const specs = notifyTransitions(prev, next, false);
  assert.strictEqual(specs.length, 1);
  assert.strictEqual(specs[0].sessionId, '1');
});

test('staying in needs-input across polls emits nothing', () => {
  const prev = [session('1', 'needs-input')];
  const next = [session('1', 'needs-input')];
  assert.deepStrictEqual(notifyTransitions(prev, next, false), []);
});

test('leaving needs-input emits nothing', () => {
  const prev = [session('1', 'needs-input')];
  const next = [session('1', 'running')];
  assert.deepStrictEqual(notifyTransitions(prev, next, false), []);
});

test('entering needs-input while the window is focused emits nothing', () => {
  const prev = [session('1', 'running')];
  const next = [session('1', 'needs-input')];
  assert.deepStrictEqual(notifyTransitions(prev, next, true), []);
});

test('a session absent from the previous list arriving already flagged emits nothing', () => {
  // First poll after page load or a web-tier restart: no prior observation
  // means no observed transition, however the session's status reads now.
  const prev: Session[] = [];
  const next = [session('1', 'needs-input')];
  assert.deepStrictEqual(notifyTransitions(prev, next, false), []);
});

test('several sessions entering needs-input in one poll each emit their own spec', () => {
  const prev = [session('1', 'running'), session('2', 'idle'), session('3', 'needs-input')];
  const next = [session('1', 'needs-input'), session('2', 'needs-input'), session('3', 'needs-input')];
  const specs = notifyTransitions(prev, next, false);
  assert.deepStrictEqual(specs.map((s) => s.sessionId).sort(), ['1', '2']);
});

test('every spec\'s tag equals its sessionId', () => {
  const prev = [session('42', 'running')];
  const next = [session('42', 'needs-input')];
  const [spec] = notifyTransitions(prev, next, false);
  assert.strictEqual(spec.tag, spec.sessionId);
  assert.strictEqual(spec.tag, '42');
});

test('a transition between two non-needs-input statuses emits nothing', () => {
  const prev = [session('1', 'idle')];
  const next = [session('1', 'running')];
  assert.deepStrictEqual(notifyTransitions(prev, next, false), []);
});

test('an unrelated session exiting alongside a real transition does not add a spec', () => {
  const prev = [session('1', 'running'), session('2', 'running')];
  const next = [session('1', 'needs-input')]; // session 2 exited/vanished
  const specs = notifyTransitions(prev, next, false);
  assert.deepStrictEqual(specs.map((s) => s.sessionId), ['1']);
});
