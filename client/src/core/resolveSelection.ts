// Which session the desktop detail pane attaches to, given the current poll,
// the selected id, and the last-resolved selection (the caller's ref cell).
// Three cases:
//   1. Selected id is in the current poll -> that session (live, or a fresh
//      'exited' tombstone row from the board's ring).
//   2. Absent from the poll but the cached selection is still *live* -> keep
//      showing it (covers transient gaps: a just-created session not yet
//      listed, the one-cycle kill-suppression window) so the pane doesn't flash empty.
//   3. Absent, and the cached selection is a *tombstone* -> null. It fell out
//      of the board's capped ring and will never reappear, so the caller
//      clears the selection and re-selects a live row instead of a frozen ghost.

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
