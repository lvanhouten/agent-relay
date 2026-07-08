## Agent Brief

**Category:** enhancement
**Summary:** Server-side hook beacons: a `/api/beacon` endpoint and a web-tier beacon-state overlay that gives Claude lines honest attention states (`running` / `turn-done`), plus the README hook recipe to drive it.

**Current behavior:**
The session store (`BoardSessions`, the web-tier surface over the board that the REST API and WS hub consume) derives each live line's attention `status` from the board's per-line `idleMs`: `running` (output within the shared idle threshold) or `idle` (quiet beyond it, rendered "quiet"). The one honest override is a `needs-input` flag a Claude Code Notification hook sets via `POST /api/notify` — held in a web-tier map keyed by board line id, timestamped, overlaid in the store's `list()`, self-cleared when output lands after the flag or when the WS hub sees an `input` frame (it calls the store's `clearAttention`), voided wholesale on a board-boot-nonce change, and pruned for ids no longer live. There is no endpoint for lifecycle beacons and no notion of a "Claude line": a mid-turn-but-silent Claude agent reads as "quiet", and a finished turn is indistinguishable from an idle shell.

Every line the board spawns already carries `AGENT_RELAY_SESSION=<board line id>` in its env, and every Claude Code hook event receives `session_id`, `transcript_path`, and `cwd` on stdin — so an exact line binding is available to a hook but nothing consumes it for lifecycle state.

**Desired behavior:**
Add a beacon channel that lets a Claude Code session report its lifecycle to the relay, and overlay that state on the line's card.

- A new authenticated `POST /api/beacon` accepts a JSON body `{ event, sessionId, claudeSessionId, transcriptPath, cwd }` where `event` is one of `SessionStart`, `Stop`, `SessionEnd`. It is mounted under the same token-gated API surface as `/api/notify` (inherits auth). It **never** sends a push notification — it carries no title/body and does not fan out to the notifier sinks.
  - Reject a non-JSON content type with 415 (same cross-site-POST guard the other POST endpoints use).
  - Reject a body whose `event` is missing/unrecognized, or whose `sessionId` / `claudeSessionId` / `transcriptPath` / `cwd` exceeds a sane length cap, with 400 and a clear error (reuse the existing field-cap validation helper).
  - On a valid body, apply the beacon to the session store and return a small success ack (200). A board-unreachable failure surfaces as a transient 503, exactly like the other board-backed endpoints — not a generic 500.

- The session store gains beacon state, held in a **new web-tier map keyed by board line id**, separate from the existing needs-input map, whose entry records the Claude session id, the transcript path, and a "turn done at" wall-clock timestamp (or null). **Presence of an entry is the definition of a "Claude line."** A public `beacon(...)` method applies an event:
  - **Target resolution mirrors `/api/notify` exactly:** when `sessionId` is present, act on that id directly (a dumb set — no existence check; an id naming an exited/unknown line is harmlessly pruned later) and do **not** consult `cwd`. The `cwd` fallback (match live lines by normalized cwd, most-recently-active line winning a tie — the same rule the existing cwd-based needs-input flagging uses) fires **only when `sessionId` is absent**. A present-but-unmatched `sessionId` must never fall through to `cwd` — that would flag a *different* same-directory live line.
  - `SessionStart` → upsert the entry and reset "turn done at" to null (a session (re)start is not a waiting state), recording the binding (Claude session id, transcript path).
  - `Stop` → set "turn done at" to now, **creating the entry if absent** (self-healing: a `Stop` alone also marks the line a Claude line).
  - `SessionEnd` → **delete the entry** (drop the marker), so the line reverts to the idle heuristic.
  - Returns the resolved line id, or null when nothing matched.

- `list()` overlays beacon state on each live line so the reported `status` resolves in this fixed precedence: **needs-input** (existing flag live) → **`turn-done`** (a Claude line whose "turn done at" is still live, i.e. no output landed after it) → **`running`** (any other Claude line — this *supersedes* the heuristic `idle`/"quiet" base for Claude lines) → the existing `idleMs` heuristic (`running`/`idle`) for non-Claude lines. Needs-input always wins over turn-done. Output landing after "turn done at" resets it to null **but keeps the entry** (so the line falls back to `running`, never "quiet"). `clearAttention(id)` (called by the WS hub on an `input` frame) additionally resets "turn done at" to null while keeping the entry.

- The beacon map is subject to the **same board-boot-nonce void and dead-id pruning** already applied to the needs-input map in `list()`.

- The transcript path and Claude session id are stored on the entry but **not surfaced** in the session DTO — captured for a future transcript feature, unconsumed here. The DTO expresses beacon state only through its existing `status` string, which can now be `'turn-done'`.

- **README hook recipe:** document three **user-scope** Claude Code hooks (`SessionStart`, `Stop`, `SessionEnd`, alongside the existing user-scope Notification recipe so they cover every repo on the machine) that `POST` to `/api/beacon` with the access token, reading `$AGENT_RELAY_SESSION` from the env as `sessionId` and `session_id` / `transcript_path` / `cwd` from the hook's stdin JSON.

**Key interfaces:**

- `BoardSessions.beacon({ event, sessionId, claudeSessionId, transcriptPath, cwd })` — new method; resolves the target line (id-exact, else cwd fallback only when id absent), applies the event, returns the resolved id or null; throws the board-unreachable error on a failed list RPC (→ 503).
- `BoardSessions.clearAttention(id)` — extended to also clear the "turn done" state (keeping the Claude-line marker), in addition to its current needs-input clear.
- `BoardSessions.list()` — its per-line overlay now resolves the four-way precedence above; its existing boot-nonce void + dead-id prune now also cover the beacon map.
- The session DTO's `status` field — gains the value `'turn-done'`; no new fields (transcript path / Claude session id stay internal).
- `POST /api/beacon` + a `validateBeaconBody(body)` returning an error string or null, plus the shared field-cap helper for the length caps.

**Acceptance criteria:**

- [ ] After a `SessionStart` beacon for a live line that is quiet, `list()` reports that line's `status` as `running` (not `idle`/quiet).
- [ ] After a `Stop` beacon (no further output), the line's `status` is `turn-done`; once output lands after the Stop, it reverts to `running` (not quiet) and the Claude-line marker is retained.
- [ ] A `SessionEnd` beacon removes the marker: the line's `status` reverts to the plain `idleMs` heuristic (`running` while recently active, `idle` once quiet).
- [ ] `clearAttention(id)` clears a live `turn-done` state (line returns to `running`), keeping the marker.
- [ ] When a line has both a live needs-input flag and a live Stop, its `status` is `needs-input` (needs-input wins).
- [ ] A line that has never beaconed reports exactly the pre-existing heuristic status — unchanged.
- [ ] A `sessionId` naming an exited/unknown line changes no live line's status and, in particular, never flags a *different* live line sharing that `cwd`; the `cwd` fallback is consulted only when `sessionId` is absent.
- [ ] A board-boot-nonce change voids all beacon state; a beacon for a dead id is pruned on the next `list()`.
- [ ] A tombstone (exited line) still reports `exited`; a `Stop` beacon never turns an exited line into `turn-done`.
- [ ] `POST /api/beacon` with a valid `SessionStart` / `Stop` / `SessionEnd` body applies the beacon and returns 200; it never invokes the push notifiers.
- [ ] `POST /api/beacon` returns 415 for a non-JSON content type, 400 for an unrecognized `event` or an oversized field, and 503 when the board is unreachable.
- [ ] Unit tests in the session-store and API test suites mirror the existing needs-input / `/notify` tests (injected rpc + clock; stubbed store) and cover the above.
- [ ] The README documents the three user-scope beacon hooks posting to `/api/beacon` with the token, reading `$AGENT_RELAY_SESSION` + stdin `session_id`/`transcript_path`/`cwd`.

**Out of scope:**

- All client rendering of the new `turn-done` status (the card dot/color/label and sort order) — brief `02-client-turn-done-rendering`.
- Consuming the stored transcript path / Claude session id (future transcript-tailing feature).
- Per-tool (`PreToolUse`/`PostToolUse`) beacons; pushing on `Stop`; persisting beacon state across relay restarts; any board-side change; any safety valve for the accepted stale-`running` case where no hook fires at all (a hard crash) — all explicitly out per the PRD and ADR-0003.

**Depends on:** none

**Covers:** VC-1, VC-2, VC-5, VC-6, VC-7, VC-8, VC-9, VC-10, VC-11, VC-12, VC-13, VC-14, VC-15

**Runtime:** parallel-safe
