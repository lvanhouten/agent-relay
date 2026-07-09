import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityRank, pickMostRecentLive } from './recency.ts';
import type { Session } from './types.ts';

function session(over: Partial<Session>): Session {
  return {
    id: 'x', name: 'x', shell: 'bash', cwd: '~', pid: 1,
    status: 'running', lastActive: 'just now', ...over,
  };
}

test('activityRank: "just now" is the most recent', () => {
  assert.equal(activityRank('just now'), 0);
});

test('activityRank: seconds/minutes/hours scale to a common unit', () => {
  assert.equal(activityRank('43s ago'), 43);
  assert.equal(activityRank('2m ago'), 120);
  assert.equal(activityRank('1h ago'), 3600);
});

test('activityRank: an unrecognized shape ranks last, never throws', () => {
  assert.equal(activityRank('yesterday'), Number.POSITIVE_INFINITY);
  assert.equal(activityRank(''), Number.POSITIVE_INFINITY);
});

test('pickMostRecentLive: returns the lowest-rank live session', () => {
  const picked = pickMostRecentLive([
    session({ id: 'a', lastActive: '5m ago' }),
    session({ id: 'b', lastActive: '10s ago' }),
    session({ id: 'c', lastActive: '2m ago' }),
  ]);
  assert.equal(picked?.id, 'b');
});

test('pickMostRecentLive: skips exited tombstones', () => {
  const picked = pickMostRecentLive([
    session({ id: 'dead', status: 'exited', lastActive: 'just now' }),
    session({ id: 'live', status: 'idle', lastActive: '3m ago' }),
  ]);
  assert.equal(picked?.id, 'live');
});

test('pickMostRecentLive: stable on ties — first in list wins', () => {
  const picked = pickMostRecentLive([
    session({ id: 'first', lastActive: 'just now' }),
    session({ id: 'second', lastActive: 'just now' }),
  ]);
  assert.equal(picked?.id, 'first');
});

test('pickMostRecentLive: null when nothing is live', () => {
  assert.equal(pickMostRecentLive([]), null);
  assert.equal(pickMostRecentLive([session({ status: 'exited' })]), null);
});
