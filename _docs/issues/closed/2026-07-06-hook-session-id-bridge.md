# A notification hook can't name the session it fired for — `/api/notify` needs a line-id bridge

**Source:** Follow-up from the Pushover + `needs-input` build (2026-07-06, `feat/pushover-needs-input`). Shipped `POST /api/notify` accepts a `sessionId` to flag a specific card, but nothing populates it automatically — so today the needs-input flag is effectively all-or-nothing per operator, not per session.
**Status:** ✅ Shipped — 2026-07-06. Both bridges landed: the board injects `AGENT_RELAY_SESSION=<line id>` into every spawned line's env (`board.js` `createLine`), and `POST /api/notify` accepts a `cwd` field that `BoardSessions.flagAttentionByCwd` resolves to a live line — sessionId wins, cwd is the fallback, most-recently-active match on a same-dir tie. README recipe updated to send both. Guarded by `env-injection.e2e.test.js` (real board) + `flagAttentionByCwd` / `/api/notify` unit tests.
**Kind:** Enhancement
**Modules:** server/board (`new` spawn env), server/api (`/api/notify` cwd-match fallback), Claude Code hooks (external config)
**Severity:** Medium — the notification/card feature works, but "which session needs me?" is only answered precisely once a hook can name its own line.

## Motivation

A Claude Code `Notification` hook knows its own `cwd` and `pid` — **not** the board line id the relay tracks. `POST /api/notify` takes an optional `sessionId` and, when present with `needsInput`, lights exactly that card (`BoardSessions.flagAttention`). But the hook has no way to know which id to send, so the shipped recipe (README) omits `sessionId`: it pushes the phone alert but can't light a *specific* card. With one session that's fine; with a fleet it's the whole "which one needs me?" question left unanswered.

This is the "line-id bridge" open question from `2026-07-06-pushover-notification-channel.md`, promoted to its own item now that the consuming endpoint exists and the flag mechanism is real.

## Proposal outline

Two independent bridges, cheapest first — they compose (env when available, cwd-match as the fallback):

- **cwd-match fallback (server-side, no board change):** let `/api/notify` accept a `cwd` field and resolve it to a line id by matching against `list()`. Cheap and needs no spawn cooperation, but `cwd` isn't unique — two sessions in the same directory are ambiguous. Resolve to the *most recently active* match, or flag all matches, and document the ambiguity. (small)
- **env injection (precise, board change):** when the board spawns a line (`new` with a `run` command), inject `AGENT_RELAY_SESSION=<id>` into the shell environment. The hook then sends `"sessionId": "$AGENT_RELAY_SESSION"` — exact, no ambiguity. Requires touching `board.js`'s pty.spawn env (the board owns PTY spawn), and only covers lines spawned *through* the relay (an `sb`-spawned or pre-existing line wouldn't carry it — the cwd-match fallback backstops those). (small–medium)

Ship the cwd-match fallback first (zero board risk, immediately useful), then env injection for precision. Update the README hook recipe to prefer `$AGENT_RELAY_SESSION` and fall back to `cwd`.

## Risks / open questions

- **cwd ambiguity:** the common fleet pattern is several agents in sibling worktrees (distinct cwds → fine), but a repo with two shells in the same dir collides. "Most recently active match" is a reasonable default; flagging all matches over-lights. Decide when built.
- **Board-env blast radius:** injecting an env var touches the shared `new` spawn path (`board.js`) — the kernel every `sb`/MCP/web line runs through. A restart to deploy it ends every live line (the standard board-change caveat). Keep the var name namespaced (`AGENT_RELAY_SESSION`) and additive.
- **Payload discipline unchanged:** `cwd` is a path, not output — safe to transit, but still not session content.

## Trigger signals to prioritize

- The first time the operator runs ≥2 agents and a phone alert fires without saying *which* session — the exact gap this closes.
- Pairs with one-tap spawn templates (`2026-07-02-fleet-spawn-templates.md`): a template that spawns through the relay is the natural place to guarantee the env var is set.
