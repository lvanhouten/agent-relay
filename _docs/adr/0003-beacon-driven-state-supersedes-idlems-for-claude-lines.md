---
status: accepted
date: 2026-07-08
deciders: Lukas Van Houten (owner), Claude (advisor)
---

# 0003 — Beacon-driven state supersedes the idleMs heuristic for Claude lines

## Context

A line's attention state on the sessions card comes from two sources today
(see CONTEXT.md *Session*, and `server/src/sessions.js`):

- the **idleMs heuristic** — `running` (output within `wait.js`'s
  `DEFAULT_IDLE_MS`) or `idle`, labeled *quiet* on purpose, because PTY bytes
  can't distinguish an agent thinking from one blocked from one finished; and
- the one honest signal, the **needs-input** flag a Claude Code Notification hook
  sets via `POST /api/notify` (the `_attention` map — web-tier only, no board
  change).

Claude Code hooks can report *every* lifecycle transition, not just needs-input:
every hook event receives `session_id`, `transcript_path`, and `cwd` on stdin,
and every line the board spawns carries `AGENT_RELAY_SESSION=<line id>` in its
env. So for a line running Claude, the relay can know the agent's actual state —
started, waiting on input, turn ended — instead of guessing from silence. The
open question is how far that knowledge should override the heuristic: only add
a new "turn done" state on top of the existing `running`/`quiet` base, or let
the fact that a line *is* a known Claude agent change the base case itself.

The motivation is the honest fleet view: *"3 running, 1 needs input, 1 turn
done"* instead of four identical *quiet* dots. That view is only achievable if a
quiet-but-mid-turn Claude line reads as **running**, not *quiet* — i.e. the base
case changes, not just an overlay.

## Decision

**For a Claude line — one the relay has beaconed (a `_beacons` entry) — the
beacon-driven state supersedes the idleMs heuristic.** A new `POST /api/beacon`
endpoint receives `SessionStart` / `Stop` / `SessionEnd` events; `BoardSessions`
keeps a web-tier `_beacons` map (`sessionId → { claudeSessionId, transcriptPath,
turnDoneAt }`). `SessionStart` establishes the marker (and resets `turnDoneAt` —
a session (re)start is not a waiting state); `Stop` sets `turnDoneAt`;
`SessionEnd` removes the entry, reverting the line to the heuristic (the agent
exited back to a plain shell). `list()`'s overlay resolves, in precedence order:

1. **needs-input** flag live → `needs-input` (a blocked tool call outranks
   everything; the existing `_attention` map is untouched).
2. Claude line with a live `Stop` (`turnDoneAt` not cleared) → `turn-done`.
3. Claude line otherwise → `running` — **the heuristic `idle`/quiet base is
   superseded**: a known Claude agent that isn't waiting is working.
4. Not a Claude line → the idleMs heuristic, exactly as today.

`turn-done` self-clears like needs-input (operator input via `clearAttention`, or
output landing after `turnDoneAt`), but clearing resets only `turnDoneAt` and
**keeps the Claude-line marker**, so the line falls back to `running`, never to
quiet. The `_beacons` map inherits the same board-boot-nonce void and
live-line pruning as `_attention`.

The **stale-`running` risk is explicitly accepted by the owner**, and `SessionEnd`
narrows it to genuine crashes only: a clean `claude` exit fires `SessionEnd`,
which removes the marker and reverts the line to the heuristic, so an ordinary
exit-to-shell is *not* stranded. The residual accepted case is a hard crash/kill
where **no** hook fires at all — the line then shows its last beacon state
(`running` or `turn-done`) forever, a confident lie where the heuristic would have
honestly said *quiet*. This is judged rare and self-healing: `SessionStart` firing
at all *proves* the hooks work, so `Stop`/`SessionEnd` normally fire; the only gap
is a process that dies without running a hook, and any output re-confirms
`running` legitimately. The honest-fleet-view payoff outweighs the narrow failure
window.

## Consequences

- The heuristic stays the **floor**, never load-bearing: it is fully in force for
  every non-Claude line and for any Claude line the relay hasn't beaconed yet
  (hooks unconfigured, or state lost to a relay restart before the next beacon).
  The supersede is strictly additive to lines that opted in by beaconing.
- Beacon state is **web-tier only and dies with the relay** — the same trade as
  `_attention`, made safe by the self-healing binding: every beacon carries the
  full identity, so a re-fired hook re-establishes a Claude line and its state
  after a restart. No board change, so no board restart to ship this.
- The state vocabulary grows to five: `running` / `idle`(quiet) / `needs-input` /
  `turn-done` / `exited`. Held there deliberately — per-tool states (`PreToolUse`/
  `PostToolUse`) are out of scope (chatty, and the card only needs coarse states).
- `turn-done` ≠ `exited`: a turn-done card is a live process waiting on the user;
  the tombstone path (a dead process) is untouched and must read differently.
- `transcriptPath`/`claudeSessionId` are stored on the `_beacons` entry but
  **unconsumed here** — captured now (they're already on hook stdin) so the
  transcript-tailing feature (`_docs/issues/2026-07-02-claude-native-lines.md`)
  becomes purely additive: this ADR is its hard prerequisite for the
  SessionStart binding.
- `/api/beacon` is a distinct endpoint, not a widening of `/api/notify`: a beacon
  reports state and never pushes, while notify is push-first and requires a
  title/body. Sharing the route would force conditional validation and conflate
  two concerns.
