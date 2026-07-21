// The pure halves of useSessions' polling guards. React-free by design:
// useSessions holds an instance in a ref so the counters never retrigger effects.

import type { Session } from './types.ts';

// Sequence guard so overlapping load()s (a slow poll interleaving with a fresh
// one) can't let an older response stomp a newer one. begin() stamps a request
// before it's sent; tryApply() answers "is this response still the newest?" and
// records it if so.
export interface PollSequence {
  begin(): number;
  tryApply(seq: number): boolean;
}

export function createPollSequence(): PollSequence {
  let issued = 0;
  let latestApplied = 0;
  return {
    begin() { return ++issued; },
    tryApply(seq) {
      // Drop a stale response: a newer load() already applied its result.
      if (seq < latestApplied) return false;
      latestApplied = seq;
      return true;
    },
  };
}

// Kill suppression: filters out ids killed locally but still present in an
// in-flight poll's stale list, so a just-killed session can't flicker back.
// Caller owns the set's lifecycle (add before DELETE, remove after reconciling)
// so a future reused id isn't permanently hidden.
export function filterKilled(list: Session[], killed: ReadonlySet<string>): Session[] {
  return list.filter((s) => !killed.has(s.id));
}
