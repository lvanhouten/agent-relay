// DTO attention state -> status dot + card label. This is the ONE place the
// client decodes the status vocabulary `server/src/sessions.js` emits
// (types.ts keeps SessionDto.status a plain string for cross-version
// tolerance, so nothing links the two vocabularies at build time — this table
// is the sync point, which is why it lives here with tests instead of inline
// in a screen).
//
// 'quiet' rather than 'idle'/'done' on purpose: a silent agent may be thinking
// (LLM latency produces legitimate 30s+ silences) or waiting on a prompt — the
// label claims only "no output lately". 'needs-input' is the honest exception:
// not heuristic silence-sniffing but a Claude Code Notification hook
// explicitly reporting the line is blocked on a prompt (server sets it via
// POST /api/notify; cleared on next input/output). It pulses so it reads
// across a grid of cards.
//
// An unknown status (a newer server behind a still-open old bundle) falls back
// LOUD — error dot, pulsing, raw status as the label — not to a dead-looking
// offline dot. History already proved the skew case is urgent: 'needs-input'
// shipped one commit after this table first did, and an old tab rendering it
// as offline would invert the attention system's purpose exactly when it
// matters. ('exited' never reaches this: the screen routes tombstones to the
// Recently-exited section; one rendering live is a bug worth seeing loudly.)

export interface AttentionView {
  dot: 'online' | 'idle' | 'attention' | 'error' | 'done';
  label: string;
  pulse: boolean;
}

const ATTENTION: Record<string, AttentionView> = {
  running: { dot: 'online', label: 'running', pulse: false },
  idle: { dot: 'idle', label: 'quiet', pulse: false },
  'needs-input': { dot: 'attention', label: 'needs input', pulse: true },
  // Turn ended, process still alive (a Claude line's agent finished its turn).
  // Distinct from needs-input by COLOR (its own dot variant +
  // --status-done token), not motion: the pulse must not be the only signal,
  // since prefers-reduced-motion disables it and a static screenshot never
  // shows it.
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
