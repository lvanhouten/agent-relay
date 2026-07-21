// DTO tombstone fields -> the status decode every "recently exited" surface
// shares (the same role core/attention.ts plays for LIVE lines). Kept here
// with tests so a future board `reason` value fails at one sync point instead
// of diverging across the sidebar, card, and detail pane.
//
// `failed` is the crash predicate: a kill or an unknown (null) exit code is
// never a crash — only a known non-zero code earns error styling. `label` is
// the terse word ('killed'/'exit N'/'exit ?'); the caller builds a fuller
// sentence from `killed`.

import type { Session } from './types.ts';

export interface TombstoneView {
  killed: boolean;
  failed: boolean;
  dot: 'error' | 'offline';
  label: string;
}

export function tombstoneView(session: Session): TombstoneView {
  const killed = session.reason === 'killed';
  const failed = !killed && session.exitCode != null && session.exitCode !== 0;
  return {
    killed,
    failed,
    dot: failed ? 'error' : 'offline',
    label: killed ? 'killed' : `exit ${session.exitCode ?? '?'}`,
  };
}
