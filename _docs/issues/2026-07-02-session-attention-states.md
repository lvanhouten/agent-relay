# Session cards can't answer "which session needs me?"

**Source:** Feature-gap brainstorm, 2026-07-02 — the cheaper sibling of the deferred live-preview idea (`2026-07-01-session-card-live-preview.md`): most of what a preview would communicate is really a one-word state.
**Status:** ✅ Phase 1 landed — 2026-07-02 (`running`/`idle` derived in `toDto()` from the board's `idleMs` against `wait.js`'s exported `DEFAULT_IDLE_MS`; card shows the dot next to the name and a labeled dot — "running" / "quiet" — beside the last-active time; `exited` came with the tombstone work). Phase 2 (`needs-input` via a Notification hook) remains proposed.
**Kind:** Enhancement
**Modules:** server/sessions, board (list reply), client/SessionsScreen
**Severity:** Medium — small effort, large navigation payoff.

## Motivation

`toDto()` hardcodes `status: 'online'` for every line (`server/src/sessions.js:37`) — the board only lists live lines, so the field is currently meaningless. Yet the raw material for a real state exists: the board's `list` reply already carries `idleMs` per line (consumed today only for the `lastActive` relative-time string), and `server/board/wait.js` already owns the canonical quiet/exited detection shared by `sb wait` and `switchboard_wait_for_idle`. Nothing surfaces any of it to the sessions screen, so with five agent sessions open the list reads as five identical "online" cards.

## Proposal outline

- Derive a state in `toDto()` from data already in hand: `running` (output within ~10s), `idle` (quiet beyond a threshold — align thresholds with `wait.js` rather than inventing a third definition). (small)
- Render it as the design system's `StatusDot` + label on the card, replacing the constant "online". (small)
- `exited` as a card state requires exited lines to survive in `list` at all — that's `2026-07-02-session-exit-metadata.md`; without it, this doc is just running/idle. (dependency, not work here)
- Phase 2 — `needs-input`: genuinely knowing "blocked on a prompt" from PTY bytes is heuristic sniffing; the honest source is a Claude Code `Notification` hook flagging the session (shared plumbing with `2026-07-02-hook-driven-push-notifications.md`). A hook-set flag on the line, cleared on next input/output, beats output-pattern matching. (medium, phase 2)

## Risks / open questions

- Threshold choice: an "idle" agent might be thinking (LLM latency produces legitimate 30s+ silences). Label accordingly — `quiet`, not `done`.
- Don't grow a third idle-detection implementation: reuse or export `wait.js`'s definition so the MCP tool, `sb wait`, and the card can't disagree about what idle means.

## Trigger signals to prioritize

- More than ~3 concurrent sessions in real use (the full-repo-audit workflow already hit this).
- Before investing in the live-preview enhancement — this answers most of the same question for a fraction of the cost, and the preview issue doc's own reopen-triggers overlap heavily with this.
