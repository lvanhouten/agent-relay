// DTO tombstone fields -> the status decode every "recently exited" surface
// shares. This is the one place the client turns a tombstone's `reason` +
// `exitCode` into a dot color, a crash predicate, and a short status word — the
// same role core/attention.ts plays for LIVE lines. It lives here with tests
// (not inline per-screen) so a future board `reason` value fails at one sync
// point instead of silently diverging across the sidebar, the session card, and
// the detail pane.
//
// `failed` is the crash predicate: dot color and badge variant must agree on it.
// A kill is expected and an UNKNOWN (null) exit code is not presented as a crash
// — only a known non-zero code earns the error styling. `label` is the terse
// status word ('killed' / 'exit N' / 'exit ?'); a fuller sentence for the detail
// banner is built by the caller from `killed`.

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
