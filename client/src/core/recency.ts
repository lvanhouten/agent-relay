// Picks the initial desktop-shell selection: the most recently active live
// session. The session DTO carries only a *formatted* relative time
// (`lastActive`, e.g. "43s ago" / "2m ago" / "just now") — no raw timestamp
// (server/src/sessions.js relTime()) — so recency has to be recovered from that
// string. activityRank maps it back to an approximate age in seconds (lower =
// more recent); an unrecognized shape ranks last rather than throwing, so a
// future relTime format degrades to "least recent" instead of crashing the
// boot selection.

import type { Session } from './types.ts';

export function activityRank(lastActive: string): number {
  const s = (lastActive ?? '').trim().toLowerCase();
  if (s === 'just now') return 0;
  const m = /^(\d+)\s*([smh])\s+ago$/.exec(s);
  if (!m) return Number.POSITIVE_INFINITY;
  const n = Number(m[1]);
  const unit = m[2];
  return unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : n;
}

// The most recently active non-exited session, or null when none are live.
// Stable on ties (the first in list order wins) so a steady set of equally
// "just now" sessions doesn't reshuffle the auto-selection every poll.
export function pickMostRecentLive(sessions: Session[]): Session | null {
  let best: Session | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const s of sessions) {
    if (s.status === 'exited') continue;
    const rank = activityRank(s.lastActive);
    if (best === null || rank < bestRank) {
      best = s;
      bestRank = rank;
    }
  }
  return best;
}
