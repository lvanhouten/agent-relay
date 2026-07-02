# A session's output dies with it — nothing survives line exit or a board restart

**Source:** Feature-gap brainstorm, 2026-07-02 — "what did that agent do before it exited?" is currently unanswerable; the evidence is gone the moment the question becomes interesting.
**Status:** 💡 Proposed — 2026-07-02.
**Kind:** Enhancement
**Modules:** board, server/sessions, client
**Severity:** Medium — the durability gap; also the foundation for any post-mortem/review workflow.

## Motivation

Scrollback is 2000 in-memory chunks per line (`SCROLLBACK` in `board.js`), and `p.onExit` deletes the whole line record (`sessions.delete(id)`, board.js:176) after sending the farewell. A board restart likewise takes every line's history with it. For a tool whose sessions are *agents doing consequential work unattended*, losing the transcript exactly when a session dies unexpectedly is backwards — that's the moment the output matters most.

## Proposal outline

- The board appends each line's output to a per-line transcript file under `%LOCALAPPDATA%\agent-relay\transcripts\<boot-nonce>-<id>.log`, capped (rotate or truncate at N MB) so a chatty line can't fill the disk. Write via the existing `onData` hook; batch/flush lazily — this must not add per-chunk sync I/O to the hot path. (medium)
- On exit, the transcript outlives the line (retention: keep last N sessions or M days, prune on board start). Pairs naturally with `2026-07-02-session-exit-metadata.md`'s tombstone registry — tombstone carries the transcript path. (small, given tombstones)
- Surface: a "recent sessions" section on the sessions screen listing tombstones; opening one shows a read-only transcript view (no WS, no input — plausibly the existing terminal screen in a static mode, or plain preformatted text with ANSI stripped). (medium)

## Risks / open questions

- **Transcripts capture what the log redaction deliberately avoided.** `board.js` logs only the run-command's *length* because argv can embed credentials — but the PTY echoes the command right back, so the transcript captures it anyway, plus any secrets in output. These files need the same owner-only posture as the board secret file — which is exactly the still-deferred W1 question (`2026-07-01-secret-file-acl-verification.md`: Windows `mode` bits are inert; the real boundary is the inherited profile ACL). Persisting transcripts raises W1's stakes considerably; consider resolving W1 first, and make persistence opt-in (`AR_PERSIST=1`) until then.
- This is a **board change**: per the dev-lifecycle rule, it only takes effect on a board restart (which ends every live line) — test on an isolated `AGENT_RELAY_PIPE` board, and note the deploy needs a deliberate restart window.
- Scope discipline: this stores *bytes for post-mortem reading*. Structured/searchable history is `2026-07-02-claude-native-lines.md` territory — don't let this doc grow a parser.

## Trigger signals to prioritize

- First "what happened before it died?" moment after an unattended session exits or a board restart wipes live history.
- Session exit metadata landing (tombstones want a transcript to point at).
