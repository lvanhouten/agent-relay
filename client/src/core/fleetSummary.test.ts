import test from 'node:test';
import assert from 'node:assert';
import { fleetSummary } from './fleetSummary.ts';
import type { Session } from './types.ts';

const s = (id: string, status: string): Session => ({
  id, name: `s-${id}`, shell: 'bash', cwd: '~', pid: 1, status, lastActive: 'just now',
});

test('empty fleet is all zeros', () => {
  assert.deepStrictEqual(fleetSummary([]), {
    live: 0, running: 0, quiet: 0, needsInput: 0, turnDone: 0, exited: 0,
  });
});

test('each known status increments live plus its own sub-bucket', () => {
  const got = fleetSummary([
    s('1', 'running'), s('2', 'running'),
    s('3', 'idle'),
    s('4', 'needs-input'),
    s('5', 'turn-done'),
  ]);
  assert.deepStrictEqual(got, {
    live: 5, running: 2, quiet: 1, needsInput: 1, turnDone: 1, exited: 0,
  });
});

test('exited sessions count only toward exited, never live', () => {
  const got = fleetSummary([s('1', 'running'), s('2', 'exited'), s('3', 'exited')]);
  assert.strictEqual(got.live, 1);
  assert.strictEqual(got.exited, 2);
});

test('an unknown live status counts toward live but no sub-bucket', () => {
  const got = fleetSummary([s('1', 'compacting'), s('2', 'running')]);
  assert.strictEqual(got.live, 2);
  assert.strictEqual(got.running, 1);
  assert.strictEqual(got.quiet, 0);
  assert.strictEqual(got.needsInput, 0);
  assert.strictEqual(got.turnDone, 0);
});
