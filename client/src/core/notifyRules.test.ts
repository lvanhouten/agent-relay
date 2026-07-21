import test from 'node:test';
import assert from 'node:assert';
import { notifyTransitions, notifyName } from './notifyRules.ts';
import type { Session } from './types.ts';

const session = (id: string, status: string, name = `s-${id}`): Session => ({
  id, name, shell: 'bash', cwd: '~', pid: 1, status, lastActive: 'just now',
});

// Built from code points (not literal ZWSP/RLO) so the source stays pure ASCII and reviewable.
const cc = String.fromCharCode;
const ZWSP = cc(0x200b), RLO = cc(0x202e), LRI = cc(0x2066), BEL = cc(0x07), ESC = cc(0x1b);

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
  // First poll after load/restart has no prior state, so no transition fires regardless of status.
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
  const next = [session('1', 'needs-input')];
  const specs = notifyTransitions(prev, next, false);
  assert.deepStrictEqual(specs.map((s) => s.sessionId), ['1']);
});

// notifyName guards the operator-supplied name before it reaches the OS banner.
test('notifyName strips zero-width and bidi-override characters', () => {
  assert.strictEqual(notifyName('a' + ZWSP + 'b' + RLO + 'c' + LRI + 'd'), 'abcd');
});

test('notifyName strips C0/C1 control characters', () => {
  assert.strictEqual(notifyName('safe' + BEL + 'name' + ESC), 'safename');
});

test('notifyName caps an overlong name at 60 chars with an ellipsis', () => {
  const out = notifyName('x'.repeat(100));
  assert.strictEqual(out.length, 60);
  assert.ok(out.endsWith('…'));
});

test('notifyName leaves an ordinary name untouched', () => {
  assert.strictEqual(notifyName('deploy-worker 2'), 'deploy-worker 2');
});

test('notifyName on empty/whitespace-only yields empty', () => {
  assert.strictEqual(notifyName(''), '');
  assert.strictEqual(notifyName('   '), '');
});

test('a spec built from a hostile name is sanitized in both title and body', () => {
  const prev = [session('1', 'running')];
  const next = [session('1', 'needs-input', 'evil' + RLO + 'name')];
  const [spec] = notifyTransitions(prev, next, false);
  assert.strictEqual(spec.title, 'evilname needs input');
  assert.strictEqual(spec.body, 'evilname is waiting on you.');
});
