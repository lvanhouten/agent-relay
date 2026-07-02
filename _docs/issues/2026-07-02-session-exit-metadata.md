# An exited session vanishes from the list — exit code and reason are shown to no one

**Source:** Feature-gap brainstorm, 2026-07-02 — the board *has* the exit code at the moment of death and throws it away with the line record.
**Status:** 💡 Proposed — 2026-07-02.
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
