// Fleet counts for the desktop overview pane, mirroring the status vocabulary
// server/src/sessions.js emits and core/attention.ts decodes: a non-exited
// session always increments `live`, then its known status increments one
// sub-bucket. An unknown live status still counts toward `live` but no
// sub-bucket, so the breakdown never over-counts a status this build can't name.

import type { Session } from './types.ts';

export interface FleetSummary {
  live: number;
  running: number;
  quiet: number;
  needsInput: number;
  turnDone: number;
  exited: number;
}

export function fleetSummary(sessions: Session[]): FleetSummary {
  const out: FleetSummary = { live: 0, running: 0, quiet: 0, needsInput: 0, turnDone: 0, exited: 0 };
  for (const s of sessions) {
    switch (s.status) {
      case 'exited': out.exited++; break;
      case 'needs-input': out.live++; out.needsInput++; break;
      case 'turn-done': out.live++; out.turnDone++; break;
      case 'idle': out.live++; out.quiet++; break;
      case 'running': out.live++; out.running++; break;
      default: out.live++; break;
    }
  }
  return out;
}
