// Which session the desktop detail pane attaches to, given the current poll,
// the selected id, and the last selection we resolved (the caller's ref cell).
//
// Pure so the transient-absence rule is unit-tested rather than living inline in
// a .jsx component. Three cases:
//   1. The selected id is in the current poll -> that session (live or a fresh
//      tombstone; a session that just exited is still present, as an 'exited'
//      row from the board's ring).
//   2. Absent from the poll but the cached last-known selection is a *live*
//      session -> keep showing it. This covers the transient gaps a poll can't
//      close instantly: a just-created session not yet listed, and the one-cycle
//      kill-suppression window. Without this the pane flashes empty for a tick.
//   3. Absent, and the cached selection is a *tombstone* -> null. A tombstone
//      that has fallen out of the poll was evicted from the board's capped
//      (20-line) ring; unlike cases (2) it will never reappear, so returning the
//      stale object would strand the pane on a frozen ghost. The caller clears
//      the selection on a null result and re-selects a live row.

import type { Session } from './types.ts';

export function resolveSelection(
  sessions: Session[],
  selectedId: string | null,
  lastKnown: Session | null,
): Session | null {
  const live = sessions.find((s) => s.id === selectedId) ?? null;
  if (live) return live;
  if (lastKnown && lastKnown.id === selectedId && lastKnown.status !== 'exited') {
    return lastKnown;
  }
  return null;
}
