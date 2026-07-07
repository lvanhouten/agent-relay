# Adversarial Review: attention states (slice 2 of 5 + seams)

**Scope:** `server/board/wait.js` (DEFAULT_IDLE_MS export), `server/src/board-client.js`, `server/src/sessions.js` (`toDto` status derivation), `client/src/core/types.ts`, `client/src/screens/SessionsScreen.jsx` (ATTENTION table), tests — "Attention states: running/quiet/exited on session cards".
**Reviewed:** `8c0634f..0c0edf4` (slice of the `3bd5d96..a19a39a` backlog review; working tree clean)
**Verdict:** CLEAN (1 WARNING at confidence 55 — extraction/convention debt; 3 low-confidence notes)

Panel: Saboteur / Maintainer / Security Auditor (single isolated pass). The one-idle-definition promise was verified as actually held (wait.js → board-client re-export → sessions.js import; no third threshold).

### Warnings

**W1. ATTENTION status→dot/label map is un-extracted, untested pure logic — and the sole sync point of a three-way string vocabulary** — `client/src/screens/SessionsScreen.jsx:101-109` · confidence 55 · Maintainer
The `ATTENTION` table plus its `?? { dot: 'offline', label: session.status }` fallback is pure mapping logic of exactly the kind the repo's own convention (CLAUDE.md: pure logic → `client/src/core` TS + unit tests; cf. `keyChips.ts`, `scrollPill.ts`, `transcript.ts`) extracts — but it lives inline in the JSX screen with zero coverage. It is also the only place the client decodes the status strings `server/src/sessions.js` emits; nothing links the two vocabularies at build or test time, so a rename on either side silently degrades to the generic offline dot with the raw string as label, with no warning anywhere.
**Fix:** extract `attentionFor(status)` into `client/src/core/attention.ts`, unit-test known keys + fallback, and `console.warn` in the fallback so an unrecognized status is discoverable in devtools.
**Resolution (fixed):** exactly as prescribed — `core/attention.ts` exports `attentionFor()` with the full vocabulary rationale in-module; tests pin all three known statuses, the fallback shape, and warn-once-per-value dedup (a 5s poll re-renders the grid, so per-render warns would drown). Mutation-proven. N1's loud fallback landed in the same module (see below).

### Notes

**N1. Stale-tab version skew renders an urgent status as a dead-looking offline dot** — `client/src/screens/SessionsScreen.jsx:109`, `client/src/core/types.ts:22` · confidence 35 · Saboteur
`status: string` (not a union) is a sanctioned decision for cross-version tolerance — the general fallback is fine. But a long-lived tab keeps the old bundle running, and history immediately proved the skew case: the very next commit adds `needs-input`, which this slice's table doesn't know. Old tab + new server ⇒ an *urgent* state renders as a non-pulsing offline dot — the inversion of the attention system's purpose.
**Fix:** make the unknown-status fallback err attention-grabbing (e.g. `error` dot, pulse) rather than `offline`, so unrecognized-but-live states can't read as dead.
**Resolution (fixed, with W1):** the fallback is now `{ dot: 'error', pulse: true, label: <raw status> }` — loud, not dead — pinned by a test naming the version-skew rationale.

**N2. `toDto()`/`relTime()` unguarded against non-finite `idleMs`** — `server/src/sessions.js:36-41,58` · confidence 30 · Saboteur
`??` covers null/undefined only. Today `board.js` always computes a numeric `idleMs`, so this isn't reachable — but it's untested, and a future board-side regression (or malformed pipe JSON) yields silent `'idle'` (NaN comparisons are false) plus `"NaNh ago"` on the card.
**Fix:** `Number.isFinite(line.idleMs) ? line.idleMs : 0` at the DTO boundary + a malformed-input unit test.

**N3. Security assumption, for the record** — `server/src/sessions.js:51-61` · confidence 20 · Security
No new surface: raw `idleMs` isn't exposed (only the derived status and the pre-existing rounded `lastActive`), and `GET /sessions` stays behind auth. The now-load-bearing assumption: `idleMs` derives purely from board-side PTY activity with no client-controllable input. Holds today; re-verify if any future feature lets a client report its own activity/heartbeat.

### Summary

The design promise this slice makes — one idle definition, shared by `sb wait`, the MCP tool, and the cards — is genuinely kept in code, not just in prose. The only real debt is W1: the client-side decode table breaks the repo's own extraction convention and is the single unlinked seam in an otherwise well-pinned vocabulary. N1's fix (attention-grabbing fallback) is a two-line change worth taking alongside it.

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| W1 | WARNING | 55 | ATTENTION map un-extracted/untested; sole vocab sync point | fixed |
| N1 | NOTE | 35 | Unknown-status fallback inverts urgency under version skew | fixed (with W1) |
| N2 | NOTE | 30 | Non-finite `idleMs` unguarded in `toDto`/`relTime` | (open) |
| N3 | NOTE | 20 | Status derivation's no-client-input assumption, recorded | (open) |
