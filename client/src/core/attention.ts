// DTO status -> dot + label. The one place the client decodes the status
// vocabulary server/src/sessions.js emits (types.ts keeps it a plain string
// for cross-version tolerance, so this table is the sync point).
//
// 'quiet' not 'idle'/'done': silence may be thinking or a prompt wait, so the
// label claims only "no output lately". 'needs-input' is the honest exception —
// a Claude Code Notification hook explicitly flagged a blocked prompt (server
// sets it via POST /api/notify, clears on next input/output) — and pulses so
// it reads across a card grid.
//
// An unknown status falls back LOUD (error dot, pulsing, raw status as label),
// never a dead-looking offline dot: an old bundle must not render a real
// attention state as if nothing needs looking at. ('exited' never reaches
// this — tombstones route to Recently-exited; one rendering live is a bug.)

export interface AttentionView {
  dot: 'online' | 'idle' | 'attention' | 'error' | 'done';
  label: string;
  pulse: boolean;
}

const ATTENTION: Record<string, AttentionView> = {
  running: { dot: 'online', label: 'running', pulse: false },
  idle: { dot: 'idle', label: 'quiet', pulse: false },
  'needs-input': { dot: 'attention', label: 'needs input', pulse: true },
  // Turn ended, process still alive. Distinct from needs-input by COLOR (its
  // own dot + --status-done token), not motion: prefers-reduced-motion disables
  // the pulse, so color must carry the signal alone.
  'turn-done': { dot: 'done', label: 'turn done', pulse: false },
};

// Warn once per unknown value, not once per render — a 5s poll re-renders the
// whole grid, and a drowned-out console is as useless as no warning.
const warned = new Set<string>();

export function attentionFor(status: string): AttentionView {
  const known = ATTENTION[status];
  if (known) return known;
  if (!warned.has(status)) {
    warned.add(status);
    console.warn(`[attention] unknown session status ${JSON.stringify(status)} — is this bundle older than the server?`);
  }
  return { dot: 'error', label: status, pulse: true };
}

// Sort precedence for the live grid: needs-input (a blocked prompt) outranks
// turn-done (a finished turn, still worth a look) outranks everything else,
// which sorts as one tier so the poll's existing order is left alone within
// it. Lower number sorts first — use as a comparator key, not a display value.
const RANK: Record<string, number> = {
  'needs-input': 0,
  'turn-done': 1,
};

export function attentionRank(status: string): number {
  return RANK[status] ?? 2;
}
