# Claude lines guess their state from idleMs when hooks could just say it

**Source:** Split out of `2026-07-02-claude-native-lines.md`, 2026-07-07 — that doc's own "hooks-only alternative" promoted to a standalone issue, because it has different risks, consumers, and trigger signals than the transcript-tailing bet it was bundled with.
**Status:** ✅ Landed — 2026-07-08 (`features/hook-beaconed-session-state`; ADR-0003, `_docs/CONTEXT.md` *Beacon*/*Claude line*/*Turn done*).
**Kind:** Enhancement
**Modules:** server/sessions, server/api, client/SessionsScreen, README (hook recipe)
**Severity:** Medium — small effort, and it finishes the attention-state story the heuristic can't.

## Motivation

Attention states today are two-source: the `idleMs` heuristic (`running`/`idle` — deliberately labeled "quiet", because PTY bytes can't tell thinking from blocked from finished) plus the one honest signal we have, the Notification-hook `needs-input` flag (landed 2026-07-06). But Claude Code hooks can report *every* transition, not just needs-input: every hook event receives `session_id`, `transcript_path`, and `cwd` on stdin, and every line the board spawns carries `AGENT_RELAY_SESSION=<line id>` in its env (the hook→line-id bridge, #29). The two halves of an exact, zero-guess binding already exist — nothing joins them.

With beacons, a fleet of Claude lines gets honest status — "3 running, 1 needs input, 1 done with its turn" — instead of four identical "quiet" dots. This supersedes the heuristic *for Claude lines only*; plain shells keep the idleMs derivation.

## Proposal outline

- **SessionStart beacon** — a hook POSTs `{ lineId: $AGENT_RELAY_SESSION, sessionId, transcriptPath, cwd }` to the relay (new `/api/beacon`, or a widened `/api/notify` — decide at build time). Web-tier map on `BoardSessions` (the `_attention` pattern — no board change): marks the line as a Claude line, stores the binding. (small)
- **Stop beacon** — the turn ended; the agent is waiting on the user. Overlay a distinct state (label carefully: "turn done", not "done" — the process is still alive and *session* stays a PTY term per CONTEXT.md). Cleared the same way `needs-input` clears: explicitly on WS input, fallback on new output. (small)
- **Beacons are idempotent and self-healing:** every hook event carries the full binding, so any beacon re-establishes state lost to a relay restart. No beacon-ordering assumptions. (design constraint, not a task)
- `toDto()` overlays beacon state on Claude lines; lines with no beacons (plain shells, repos without the hooks configured) degrade to today's heuristic untouched. (small)
- Card renders the new states; README hook recipe grows the two hook entries (user-scope, like the Notification recipe, so it covers every repo on the machine). (small)
- **`transcriptPath` is stored but deliberately unconsumed here.** Its only consumer is the transcript tailer in `2026-07-02-claude-native-lines.md` — captured now because the value is already on stdin and it makes that issue purely additive.
- Explicitly out of scope: reading transcripts, `PreToolUse`/`PostToolUse` per-tool status ("running Bash…"). Tempting, but per-tool beacons are chatty (every tool call = 2 POSTs) and the card only needs the coarse states; revisit if a consumer asks.

## Risks / open questions

- **Hookless lines are the default.** Beacons only exist where the user has the hooks configured; the overlay must be additive, never load-bearing — the heuristic stays the floor.
- **Stop ≠ exited.** A Stop-flagged card and an exited tombstone must read differently; the tombstone path is untouched.
- **State vocabulary creep:** `running` / `idle` / `needs-input` / `exited` + a new turn-done state is five. Keep it there; resist per-tool states (see out-of-scope).
- Web-tier beacon state dies with the relay process — acceptable (same trade as `_attention`), given the self-healing constraint above.

## Trigger signals to prioritize

- Effectively already fired: the needs-input flag proved the plumbing, and real fleet use (audit workflow, conduct-feature) is routinely >3 concurrent Claude lines.
- Hard prerequisite for `2026-07-02-claude-native-lines.md` — the tailer needs the SessionStart binding.

## Cross-references

- `2026-07-02-session-attention-states.md` — landed; this extends its state vocabulary for Claude lines rather than reopening it.
- `2026-07-02-claude-native-lines.md` — the transcript-tailing bet this was split from; consumes `transcriptPath`.
- `2026-07-02-hook-driven-push-notifications.md` — same hook plumbing family; a Stop beacon is also a natural push trigger later.
