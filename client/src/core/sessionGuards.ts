// The pure halves of useSessions' polling guards, extracted so they can be
// unit-tested directly (they were previously proven only as named guarded code
// paths inside SessionsScreen). React-free by design: useSessions holds an
// instance in a ref precisely so the counters never retrigger effects.

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

// Kill suppression: ids killed locally but possibly still present in an
// in-flight poll's stale list are filtered out, so a just-killed session can't
// flicker back for a poll cycle. The caller owns the set's lifecycle (add
// before the DELETE, remove after reconciling against a fresh list, so a
// future reused id isn't permanently hidden).
export function filterKilled(list: Session[], killed: ReadonlySet<string>): Session[] {
  return list.filter((s) => !killed.has(s.id));
}
