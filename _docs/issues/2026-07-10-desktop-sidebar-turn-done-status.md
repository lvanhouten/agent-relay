# Desktop sidebar renders `turn-done` as a red error dot

**Source:** Harvest of desktop-shell-v1 (finish-feature close-out, 2026-07-10). A cross-feature interaction, not a defect in either feature alone.
**Status:** 💡 Proposed — 2026-07-10. Actionable now (both features are on `main` once desktop-shell-v1 merges).
**Kind:** Bug (cosmetic / signal inversion)
**Modules:** client core (`client/src/core/attention.ts`), desktop Sidebar (consumes `attentionFor`)
**Severity:** Low — cosmetic, single-operator, no crash. Small effort.

## Motivation

Feature #40 (hook-beaconed session state, ADR 0003 `beacon-driven-state-supersedes-idlems-for-claude-lines`) merged to `main` while desktop-shell-v1 was in flight. It added a **new DTO status value, `turn-done`**: a Claude line whose agent has ended its turn and is waiting on the user (the process/PTY stay alive — deliberately not `exited`).

desktop-shell-v1's sidebar decodes `session.status` through `attentionFor` in `client/src/core/attention.ts`. That table (`running` / `idle` / `needs-input`) has **no `turn-done` entry**, so it hits the deliberate forward-compat fallback: an unknown status renders **LOUD** — `dot: 'error'`, `pulse: true`, `label: status` — plus a one-time console warn.

The fallback is correct *as a fallback* (a genuinely unknown status from a newer server should shout, not look offline — see the module docstring). But `turn-done` is not unknown-and-alarming; it is a **benign waiting state**. So post-merge, every Claude line that finishes its turn shows a **red pulsing error dot labeled `turn-done`** in the desktop sidebar — inverting the attention signal exactly where the operator glances to triage the fleet.

Reachable whenever: `main` has both features (true after this PR merges), a spawned line runs Claude Code with the beacon hooks configured, and it's viewed in the desktop shell. Cosmetic only — the mobile `SessionsScreen` shares the same `attentionFor`, so it has the same gap.

## Proposal outline

- Add a `turn-done` entry to the `ATTENTION` table in `attention.ts` — a calm "waiting" presentation distinct from both `running` (online, no pulse) and `needs-input` (attention/pulse). Candidate: `{ dot: 'idle', label: 'waiting', pulse: false }`, or a dedicated dot tier if the design wants turn-done visually separable from heuristic `idle`/quiet. (small)
- Mirror `attention.test.ts` with the new arm; mutation-prove it (drop the entry → the case falls back to the error dot).
- **Out of scope for desktop-shell-v1** by design: v1's PRD scoped attention to `needs-input` only; `turn-done` is #40's beacon vocabulary. This is the seam where the two meet, hence a follow-up rather than a v1 change.

## Risks / open questions

- **Design call, not just a code fill:** should `turn-done` (agent waiting on you) read the *same* as heuristic `idle`/quiet (no agent, just silent), or get its own visual tier? They mean different things — the former is "your move," the latter is "nothing's happening." A shared `idle` dot conflates them; a distinct tier is more honest but adds a dot color. Worth deciding before filling the table.
- Whether the mobile `SessionsScreen` card `ATTENTION` table (separate from `core/attention.ts`) needs the same entry — check both decode sites when fixing.

## Trigger signals to prioritize

- desktop-shell-v1 has merged and a Claude line with beacon hooks is viewed in the desktop sidebar (the red-dot-on-turn-done is visible in daily use).
- Any complaint that a finished/waiting agent "looks like an error" in the fleet view.
