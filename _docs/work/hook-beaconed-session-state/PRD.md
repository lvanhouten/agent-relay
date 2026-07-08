# PRD — Hook-beaconed session state

## Problem Statement

An operator watching a fleet of Claude Code sessions on the sessions screen
can't tell, at a glance, which agents are actually working, which have finished
their turn and are waiting on a reply, and which are just quiet. Today a line's
attention state comes from two sources: the `idleMs` heuristic (`running` /
`idle`, labeled *quiet* — because PTY bytes can't distinguish thinking from
blocked from finished) and the one honest signal, the `needs-input` flag a
Claude Code Notification hook sets via `POST /api/notify`. So a fleet of five
Claude lines that are variously mid-turn, done-with-their-turn, and genuinely
idle collapses into "four identical *quiet* dots" — the operator has to attach to
each line to learn its real state.

The information to do better already exists and nothing joins it: every Claude
Code hook event receives `session_id`, `transcript_path`, and `cwd` on stdin,
and every line the board spawns carries `AGENT_RELAY_SESSION=<line id>` in its
env. The two halves of an exact, zero-guess binding are present but unused.

## Solution

A Claude Code session reports its lifecycle transitions to the relay via
**beacons** — hook-driven POSTs to a new `POST /api/beacon` endpoint carrying
the full self-healing binding (`sessionId` = the board line, plus
`claudeSessionId`, `transcriptPath`, `cwd`). Three events are beaconed:
`SessionStart` (the line is now a **Claude line**), `Stop` (the agent ended its
turn and is waiting on the user), and `SessionEnd` (the agent exited — drop the
Claude-line marker so the line, now a plain shell, reverts to the heuristic).

For a Claude line — one the relay has beaconed — the beacon-driven state
**supersedes** the `idleMs` heuristic (ADR-0003): a known Claude agent that isn't
waiting reads as `running` (working), a stopped one reads as the new **turn
done** state, and a mid-turn permission block still reads as `needs-input`. The
sessions screen shows an honest fleet view — "3 running, 1 needs input, 1 turn
done" — instead of undifferentiated quiet dots. Lines with no beacons (plain
shells, or repos whose hooks aren't configured) are untouched and keep the
heuristic exactly as today; the overlay is strictly additive.

Beacon state lives on the web tier only and dies with the relay process — the
same trade as the existing `needs-input` flag — made safe because every beacon
carries the full binding, so a re-fired hook re-establishes state after a
restart. No board change.

## User Stories

1. As an operator watching a Claude fleet, I want a line that is actively working
   (an agent mid-turn, even while silent) to read as **running** rather than
   *quiet*, so that a normal LLM pause isn't misreported as an idle session.
2. As an operator, I want a line whose agent has ended its turn and is waiting on
   me to read as **turn done**, so that I can see at a glance which sessions want
   my reply.
3. As an operator, I want a turn-done card to look distinct from a *needs-input*
   card (blocked mid-turn) and from an *exited* tombstone (a dead process) — by a
   distinct dot **color**, not motion alone, so the three "not actively working"
   cases stay distinguishable at a glance, in a screenshot, and under
   `prefers-reduced-motion`.
4. As an operator, I want turn-done and needs-input cards lifted to the top of the
   live grid (needs-input first, then turn-done), so that the sessions that want
   me are the ones my eye lands on first.
5. As an operator, I want a turn-done card to return to **running** the moment the
   agent produces new output, and to clear the instant I answer from the web
   terminal, so that the state reflects the live session without a stale "waiting"
   badge.
6. As an operator, when a Claude agent exits back to a shell (a `SessionEnd`
   beacon), I want that line to revert to the plain-shell heuristic (running while
   active, quiet once idle) rather than stay stuck on `running`/`turn-done`, so
   that a finished agent's live shell isn't misreported.
7. As an operator running plain shells or repos without the hooks configured, I
   want those lines' attention states unchanged, so that adding beacons for Claude
   lines never degrades the sessions I didn't opt in.
8. As an operator whose relay restarted mid-session, I want the next hook event
   from a live Claude session to re-establish its Claude-line status and state, so
   that a restart doesn't permanently strand a line on the heuristic.
9. As an operator, I want a beacon to never buzz my phone or post a push
   notification, so that lifecycle reporting is silent and distinct from the
   `needs-input` notification path.
10. As the maintainer, I want a malformed or unknown beacon (bad `event`,
    oversized fields, non-JSON body) rejected with a clear client error and no
    state change, so that the endpoint can't be driven into an inconsistent state.
11. As the maintainer, I want a beacon whose `sessionId` names an exited line, or
    whose `cwd` matches no live line, to change nothing (not error, and never flag
    a *different* same-directory line), so that a stale or racing hook is harmless.

> Note: capturing each Claude line's `transcriptPath` / `claudeSessionId` for the
> future transcript-tailing feature is an implementation decision, not a user
> story — it has no observable consequence in *this* feature (the values are
> stored but unconsumed), so it carries no validation-contract assertion. See
> *Implementation Decisions* (Module 1, DTO) and *Further Notes*.

## Implementation Decisions

**Module 1 — `BoardSessions` beacon state (`server/src/sessions.js`, extend the
deep module).** A new web-tier `_beacons` map keyed by board line id, whose value
holds `{ claudeSessionId, transcriptPath, turnDoneAt }` (`turnDoneAt` is a
wall-clock ms or null). **Presence in the map is the definition of a "Claude
line."** Public surface:

- `beacon({ event, sessionId, claudeSessionId, transcriptPath, cwd })` — resolves
  the target line id the **same way `/api/notify` does** and no other: when
  `sessionId` is **present**, act on that id directly and stop (a dumb set, like
  `flagAttention` — no existence check; an id for an exited/unknown line is set
  and harmlessly pruned on the next `list()`); the `cwd` fallback fires **only
  when `sessionId` is absent**, matched via the same live-line list-RPC +
  `most-recently-active-on-a-tie` rule as `flagAttentionByCwd`. A present-but-
  unmatched `sessionId` must **never** fall through to `cwd` — that would flag a
  *different* same-directory live line (the exited-line bug). Event handling: on
  `SessionStart`, upsert the entry and **reset `turnDoneAt: null`** (a session
  (re)start is not a waiting state); on `Stop`, set `turnDoneAt = now`, **creating
  the entry if absent** (self-healing — a `Stop` alone also marks the line a
  Claude line); on `SessionEnd`, **delete the entry** (drop the marker → the line
  reverts to the heuristic). Returns the resolved id, or null when nothing
  matched. Board-down surfaces as `BoardUnreachableError` (→ 503), same contract
  as `flagAttentionByCwd`.
- `_applyBeacon(dto, line)` — pure overlay used inside `list()`: for a Claude line,
  override the heuristic base to `running`, unless a **live** `turnDoneAt`
  (no output landed after it) makes it `turn-done`. Output-after-`turnDoneAt`
  resets `turnDoneAt` to null **but keeps the map entry** (the marker), so the
  line falls back to `running`, never to `quiet`. Non-Claude lines pass through
  unchanged. This output-after-flag clear **inherits the same accepted soft-
  failure documented for `_applyAttention`**: a laggy hook racing a late TUI
  repaint (or an attach-triggered resize repaint) can read as "the agent moved
  again" and false-clear turn-done early — a stale card, never corruption; the
  same optional grace-window mitigation applies if it shows up in practice.
- `clearAttention(id)` — extended to also reset `turnDoneAt` to null (keeping the
  marker) in addition to deleting the needs-input flag, so a WS `input` frame
  clears both waiting states at once.

**Precedence.** `list()` composes the two overlays as
`_applyAttention(_applyBeacon(toDto(line), line), line)`, yielding the fixed
order **needs-input > turn-done > running > heuristic(running/idle)**:
`_applyBeacon` establishes the Claude-line base (`running`/`turn-done`), then the
existing `_applyAttention` overlays `needs-input` on top when its flag is live, so
needs-input always wins. The `_beacons` map is subject to the **same board-boot-
nonce void and dead-id pruning** already applied to `_attention` in `list()`
(a board restart reuses line ids, so both maps are cleared on a boot-nonce
change; entries for ids no longer live are pruned each list).

**DTO.** `toDto()` gains no new fields — the beacon state is expressed only
through the existing `status` string, which can now be `'turn-done'`.
`transcriptPath` and `claudeSessionId` are stored on the `_beacons` entry and
**deliberately not surfaced** in the DTO (captured for the future transcript
tailer; unconsumed here).

**Module 2 — `POST /api/beacon` + `validateBeaconBody` (`server/src/api.js`,
extend).** A thin HTTP seam mounted under the existing token-gated `/api` router
(so it inherits auth for free). `validateBeaconBody` requires `event ∈
{'SessionStart', 'Stop', 'SessionEnd'}` and enforces string length caps on `sessionId`,
`claudeSessionId`, `transcriptPath`, and `cwd` (reusing the `validateFieldCaps`
helper). The handler: 415 on a non-JSON content type (same cross-site-POST guard
as `/sessions` and `/notify`), 400 on a validation error, otherwise calls
`sessions.beacon(...)` and returns a small ack; board-down maps to 503. It never
calls `notifyAll` — a beacon carries no title/body and never pushes.

**Module 3 — `attention.ts` + StatusDot dot (`client/src/core/` +
`_docs/design-system/`, extend).** Give `turn-done` a **distinct dot color**, not
a reused-with-pulse-off `attention` dot — motion alone fails under
`prefers-reduced-motion` (StatusDot's CSS disables the pulse animation there) and
in screenshots, exactly the phone/RDP/screenshot paths this project targets. So:
add a new StatusDot variant (e.g. `done`) backed by a new `--status-*` design
token, and enter `'turn-done': { dot: 'done', label: 'turn done', pulse: false }`
in the `ATTENTION` table. The color is the primary distinguisher; the label
(`turn done` vs `needs input`) is the secondary. Also add a pure
`attentionRank(status): number` helper co-located with the table, encoding the
sort precedence (needs-input highest, then turn-done, then the rest equal) so the
two-level sort is a tested function rather than inline JSX.

**Module 4 — `SessionsScreen.jsx` (`client/src/screens/`, wiring only).** Replace
the inline single-key needs-input sort with a sort by `attentionRank`, and let
the existing card renderer pick up the `turn-done` status through the
`attentionFor` table (a turn-done card is a live card, not routed to the
Recently-exited tombstone section). No new component logic.

**Module 5 — `types.ts` (`client/src/core/`).** Update the `SessionDto.status`
doc comment to include `'turn-done'` and its meaning (turn ended, process alive,
distinct from `'exited'`). Type/comment only.

**Module 6 — README hook recipe.** Add three **user-scope** hook entries
(`SessionStart`, `Stop`, and `SessionEnd`, like the existing user-scope
Notification recipe so they cover every repo on the machine) that POST to
`/api/beacon` with the access token, reading `$AGENT_RELAY_SESSION` from the env
and `session_id` / `transcript_path` / `cwd` from the hook's stdin JSON.

## Testing Decisions

Good tests here assert **external behavior** — the `status` a line reports given a
sequence of beacons, clears, output, and board restarts; the HTTP status and
side-effect of a beacon POST; the decoded card view and sort rank for a status —
never the shape of the `_beacons` map itself. Prior art is directly applicable
and should be mirrored.

- **Module 1 (`sessions.js`)** — unit tests in `server/src/sessions.test.js`,
  mirroring the existing `flagAttention` / `flagAttentionByCwd` / boot-nonce /
  prune tests (injected `rpc` + clock, no live board). Cover: SessionStart marks a
  quiet line `running` (supersede); Stop marks it `turn-done`; output after Stop
  reverts to `running` (not `quiet`) while keeping the marker; SessionEnd removes
  the marker so the line reverts to the heuristic (`running`/`quiet`);
  `clearAttention` clears turn-done; needs-input outranks turn-done when both are
  live; a present `sessionId` naming an exited line flags nothing and never falls
  through to a same-cwd live line; the `cwd` fallback resolves like
  `flagAttentionByCwd` only when `sessionId` is absent; a board-boot-nonce change
  voids `_beacons`; a dead id is pruned; a non-Claude line is untouched.
  **Runtime: parallel-safe** (pure in-process, injected deps).
- **Module 2 (`api.js`)** — unit tests in `server/src/api.test.js`, mirroring the
  existing `/notify` tests (stub `sessions`). Cover: a valid
  SessionStart/Stop/SessionEnd calls `sessions.beacon` and 200s; a bad `event` and
  an oversized field 400; a non-JSON body 415; a board-unreachable `beacon` maps
  to 503; a beacon never invokes the notifiers. **Runtime: parallel-safe.**
- **Module 3 (`attention.ts`)** — unit tests in `attention.test.ts`, mirroring the
  existing `attentionFor` cases. Cover: `attentionFor('turn-done')` returns the
  distinct-color `done` dot with `pulse: false` (a color, not motion, so it
  survives reduced-motion); `attentionRank` orders needs-input > turn-done >
  running = idle. **Runtime: parallel-safe** (Node type-stripping, no DOM).
- **Modules 4–6** — no automated tests. Module 4 is JSX wiring proven by the pure
  `attentionRank`/`attentionFor` it calls; Module 5 is a comment; Module 6 is docs.

## Out of Scope

- **Reading transcripts.** `transcriptPath` / `claudeSessionId` are stored but
  unconsumed; the transcript tailer is `2026-07-02-claude-native-lines.md`.
- **Per-tool states** (`PreToolUse` / `PostToolUse`, e.g. "running Bash…").
  Chatty (every tool call is two POSTs) and the card only needs coarse states;
  the vocabulary stays at five (`running` / `idle` / `needs-input` / `turn-done` /
  `exited`).
- **Pushing on Stop.** A Stop beacon never triggers a push notification here
  (that's a natural later trigger, `2026-07-02-hook-driven-push-notifications.md`).
- **Board-side state.** No board change; beacon state is web-tier only and dies
  with the relay (self-healing covers the restart case).
- **Persisting beacon state** across relay restarts. Deliberately not done — the
  self-healing binding re-establishes it on the next beacon.
- **A safety valve for the residual stale-`running` risk.** `SessionEnd` handles
  the clean-exit case (marker dropped → heuristic); the residual is a hard
  crash/kill where **no** hook fires at all, leaving the last beacon state shown
  until the PTY exits. Explicitly accepted per ADR-0003, not further mitigated
  here.

## Further Notes

- The supersede decision, its accepted stale-`running` trade-off, and the
  web-tier/self-healing stance are recorded in **ADR-0003**. The
  *Beacon* / *Claude line* / *Turn done* glossary terms are in **CONTEXT.md**.
- The `sessionId` = board line / `claudeSessionId` = Claude's-own naming keeps
  `/api/beacon` consistent with `/api/notify` (where `sessionId` already means the
  board line) and with the glossary's *Session* = the board line.
- This feature is the hard prerequisite for the transcript-tailing bet
  (`2026-07-02-claude-native-lines.md`): capturing `transcriptPath` /
  `claudeSessionId` now makes that feature purely additive.
