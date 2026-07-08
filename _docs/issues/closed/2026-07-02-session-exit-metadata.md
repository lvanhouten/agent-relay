# An exited session vanishes from the list — exit code and reason are shown to no one

**Source:** Feature-gap brainstorm, 2026-07-02 — the board *has* the exit code at the moment of death and throws it away with the line record.
**Status:** ✅ Resolved — 2026-07-02.

## Resolution

Implemented as outlined, with one already-done discovery: bullet 3 (exit code in the
WS `exit` frame) had existed end-to-end since the board-client extraction —
`attach()` parses the code out of the farewell sentinel (`EXIT_RE`), `ws.js` sends
`{ type: 'exit', code }`, and `TerminalView` prints "session exited · code N". What
landed here:

- Board: `makeEndedRegistry` — a capped ring (20) of `{ id, name, shell, cwd,
  exitCode, endedAt, reason }` tombstones written in `p.onExit`; the `end` command
  marks `endReason: 'killed'` before the signal so an operator kill is
  distinguishable from a natural exit. `list` replies gain an additive `ended`
  array; new `forget` command dismisses one tombstone. In-memory only, which is
  also the id-reuse hygiene: a board restart clears the ring.
- Web tier: `endedToDto` maps tombstones to `status: 'exited'` +
  `exitCode`/`reason`; `kill()` falls through `end` → `forget` so DELETE on an
  exited session is a dismiss; the WS hub refuses a tombstone attach with 1008.
- Client: collapsed "Recently exited (N)" section on the sessions screen;
  dismissable cards with a `killed` / `exit N` badge (danger-styled on a non-zero
  natural exit — a ConPTY kill reports STATUS_CONTROL_C_EXIT, which is exactly why
  `reason` exists). Header count stays live-only.

Verified: unit tests (registry ring/forget, DTO mapping, kill fallthrough, wire
surface) plus an isolated-board e2e (natural exit code 3 → `reason: 'exited'`;
`end` → `reason: 'killed'`; forget semantics) and a browser pass over the full
stack (crash → red `EXIT 3` badge, kill → neutral `KILLED`, dismiss → 204 +
board-side forget).
**Kind:** Enhancement
**Modules:** board, server/sessions, client/SessionsScreen
**Severity:** Low–Medium — small board change with outsized "wait, where did my session go?" payoff.

## Motivation

`p.onExit` receives `{ exitCode }` (`board.js:168`), sends a farewell to currently-attached clients, then deletes the line (`sessions.delete(id)`). Anyone *not attached at that instant* — which is the normal case for an unattended agent run — sees the session silently disappear from the next 5s poll. There's no distinguishing "finished cleanly" from "crashed", or noticing the exit happened at all. `toDto`'s hardcoded `status: 'online'` (sessions.js:37) is downstream of the same gap: the board's `list` has no non-live lines to report.

## Proposal outline

- Board keeps a small **tombstone registry**: on exit, instead of pure deletion, record `{ id, name, shell, cwd, exitCode, endedAt }` in a capped ring (last ~20). `list` gains an `ended` array (or an `--all` flag) alongside live lines; `end`-command kills record a distinguishable reason (`killed` vs. exit code). (small–medium)
- `toDto()` maps tombstones to `status: 'exited'` with `exitCode`; `SessionsScreen` renders them in a collapsed "recent" section with a dismiss (dismiss = drop the tombstone via a new `forget` command, or just client-side hide). (small)
- The WS `exit` frame already reaches attached terminals; thread `exitCode` into its payload so the terminal screen can show "exited (code 1)" instead of a bare disconnect. (small)

## Risks / open questions

- Id-reuse hygiene: line ids restart per boot (the MCP server already namespaces its cursors by boot nonce for exactly this reason) — tombstones must carry the boot nonce or be cleared on board start so a reused id can't show a stale corpse next to its live successor.
- This is a **board change** — takes effect only on a board restart (ends every live line); develop against an isolated `AGENT_RELAY_PIPE` board.
- Keep the tombstone tiny and unstructured; transcript retention is `2026-07-02-scrollback-persistence.md`'s job (a tombstone may carry a transcript path once that exists).

## Trigger signals to prioritize

- Any unattended run ending in silent disappearance — especially a crash mistaken for success.
- Attention states (`2026-07-02-session-attention-states.md`) landing: `exited` is the state that doc can't provide without this one.
