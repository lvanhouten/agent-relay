// Direct tests for the poll guards that useSessions consumes.
import test from 'node:test';
import assert from 'node:assert';
import { createPollSequence, filterKilled } from './sessionGuards.ts';
import type { Session } from './types.ts';

const session = (id: string): Session => ({
  id, name: `s-${id}`, shell: 'bash', cwd: '~', pid: 1, status: 'running', lastActive: 'just now',
});

test('pollSequence: a response applies in the ordinary case', () => {
  const guard = createPollSequence();
  const seq = guard.begin();
  assert.strictEqual(guard.tryApply(seq), true);
});

test('pollSequence: a stale response is dropped after a newer one applied', () => {
  // The W-flicker scenario: poll A is slow; poll B starts later, resolves first.
  const guard = createPollSequence();
  const a = guard.begin();
  const b = guard.begin();
  assert.strictEqual(guard.tryApply(b), true);   // fresh poll lands
  assert.strictEqual(guard.tryApply(a), false);  // slow old poll must not stomp it
});

test('pollSequence: in-order responses all apply', () => {
  const guard = createPollSequence();
  const a = guard.begin();
  const b = guard.begin();
  assert.strictEqual(guard.tryApply(a), true);
  assert.strictEqual(guard.tryApply(b), true);
});

test('pollSequence: re-applying the same seq is allowed (seq < latest is the only stale case)', () => {
  // Only strictly-stale (seq < latestApplied) is rejected; pins against a future `<=` port breaking this.
  const guard = createPollSequence();
  const a = guard.begin();
  assert.strictEqual(guard.tryApply(a), true);
  assert.strictEqual(guard.tryApply(a), true);
});

test('filterKilled: a locally-killed id is suppressed from a stale list', () => {
  const list = [session('1'), session('2'), session('3')];
  const filtered = filterKilled(list, new Set(['2']));
  assert.deepStrictEqual(filtered.map((s) => s.id), ['1', '3']);
});

test('filterKilled: an empty suppression set passes the list through', () => {
  const list = [session('1'), session('2')];
  assert.deepStrictEqual(filterKilled(list, new Set()), list);
});
