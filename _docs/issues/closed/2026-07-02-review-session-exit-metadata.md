## Adversarial Review: session-exit-metadata branch vs main

**Scope:** 6 code files changed (+~200 reviewable lines) across 1 commit — board tombstone registry + `forget` command (`server/board/board.js`, `board.test.js`); the web-tier seam that maps tombstones to `exited` DTOs and refuses their attach (`server/src/sessions.js`, `sessions.test.js`, `server/src/ws.js`); and the client tombstone card + collapsed "Recently exited" section (`client/src/core/types.ts`, `client/src/screens/SessionsScreen.jsx`). Doc-only changes (`CLAUDE.md`, `server/board/README.md`, the feature's own issue doc, `.gitignore`) excluded from the budget.
**Reviewed:** `15f72d3..HEAD` (`1c764f9`, single commit), working tree clean.
**Pre-checks:** `npm test --workspace=server` — 86/86 pass (incl. the new registry ring/forget, wire-surface `list`/`forget`, and DTO/kill-fallthrough cases); `npm test --workspace=client` — 37/37 pass; `npm run typecheck --workspace=client` — 0 errors. No mechanical issues open.
**Verdict:** CLEAN — 1 confirmed (non-speculative) WARNING to address before merge; no criticals, remainder are notes.

### Warnings

**W1. The killed-vs-exited `reason` invariant — the feature's whole point — has no automated regression guard** — `server/board/board.js:205` · confidence 60

**Status:** ✅ Resolved in ad51a08.
**Resolution:** Took the integration-test option (the pure-helper alternative can't guard the set-before-kill *ordering*, which is the actual risk). New `server/board/tombstone.e2e.test.js` spawns a real board daemon on an isolated `AGENT_RELAY_PIPE`, drives both exit paths (a `cmd /c exit 3` line → asserts `reason: 'exited'` + `exitCode: 3`; a live line ended via `end` → asserts `reason: 'killed'`), and runs under the normal `npm test --workspace=server` (own process, so the pipe override can't leak; ~2.9s).

The distinction this feature exists to draw (an operator kill vs. a process exiting on its own) rides on a two-part contract that no unit test exercises:

1. The `end` handler must set `s.endReason = 'killed'` **synchronously before** `s.pty.kill()`, because `onExit` fires async and reads it (`board.js:341`, with the ordering called out in a comment).
2. `onExit` records `reason: s.endReason || 'exited'` (`board.js:205`) — the `|| 'exited'` default branch.

`board.test.js` covers the *pure* registry (`makeEndedRegistry` ring + `forget`) and the *wire* surface (`handle('list')` carries `ended`, `handle('forget')` dismisses), but always with **hand-injected** tombstones. The path that actually produces a tombstone — `createLine` → `end` → `onExit` — and the `endReason` handoff inside it are verified only by the manual isolated-board e2e described in the design doc (`2026-07-02-session-exit-metadata.md:28-32`), which does not run in CI. So a refactor that moves the `endReason` assignment after `pty.kill()`, or drops it, silently regresses every operator kill to `reason: 'exited'` — and since a ConPTY kill reports a *non-zero* `STATUS_CONTROL_C_EXIT` (the documented reason `reason` exists at all, design doc `:24-26`), that regression flips every killed session to a red "crash" badge on the client (see N2) with no test failing.

*Why it's a WARNING, not a CRITICAL/blocker:* the invariant is currently correct and was e2e-verified, and it's genuinely hard to unit-test — `createLine` spawns a real pty with no injection seam, so the honest coverage would be a spawn-a-shell-and-kill-it integration test. *Fix:* either add a small integration test (spawn a trivial shell line on an isolated `AGENT_RELAY_PIPE`, `end` it, assert the resulting tombstone's `reason === 'killed'`; separately let one exit on its own and assert `'exited'`), or refactor the tombstone-record + reason-resolution into a pure helper (`(exitCode, endReason) -> tombstone`) that unit tests can drive without a pty, leaving only the timer-free ordering in `onExit`.

*Verdict basis:* Saboteur lens — "a changed branch whose only test is the happy path is a finding." The `|| 'exited'` default and the set-before-kill ordering are grounded, un-covered branches; confidence is on the *existence* of the gap (certain — the suite is right there), tempered on impact by the manual e2e that did verify it once.

### Notes

**N1. `endedToDto` duplicates `toDto`'s field mapping and the `session-${id}` name fallback** — `server/src/sessions.js:46` · confidence 45

**Status:** ✅ Resolved in ad51a08.
**Resolution:** `endedToDto` now spreads `toDto(...)` over the tombstone's base fields and overrides only the exit-specific ones (`pid`, `status`, `exitCode`, `reason`, `lastActive`), so a field added to the base session shape lands in both producers and the `session-${id}` fallback has one home.

`endedToDto` (`:46-58`) re-emits `id`, the `name || \`session-${id}\`` fallback, `shell`, `cwd`, `pid: null`, and a `relTime(...)` `lastActive` — the same shape `toDto` (`:30-40`) builds, plus `status`/`exitCode`/`reason`. The two will drift: a future field added to the session DTO (the attention-states proposal is named as the next toucher) lands in one function and silently not the other, and the `session-${id}` fallback is now maintained in two places. The comment acknowledges "Same shape as `toDto` plus the exit metadata," so the duplication is deliberate for clarity — but a maintainer changing the DTO has no compiler signal that a second producer exists. Consider `endedToDto` spreading `toDto`-derived base fields and overriding `status`/`pid`/`lastActive`, or a shared `baseDto()` both call. Recoverable and low-churn, hence NOTE.

**N2. The client's "is this a crash" predicate is duplicated across two sites and treats an unknown (`null`) exit code as an error** — `client/src/screens/SessionsScreen.jsx:143` · confidence 40

**Status:** ✅ Resolved in ad51a08.
**Resolution:** As suggested: one `failed = !killed && session.exitCode != null && session.exitCode !== 0` predicate feeds both the status dot and the badge variant; an unknown (`null`) exit code now renders neutral (`exit ?` on a grey badge), not as a crash.

`!killed && session.exitCode !== 0` appears verbatim at `:143` (the status-dot color) and `:172` (the badge `danger`/`neutral` variant). Two edits to change one rule. Separately, when `exitCode` is `null` — which `endedToDto` can emit (`t.exitCode ?? null`) for an older board or a malformed tombstone — `null !== 0` is `true`, so an *unknown* exit code renders as a red "error" dot + `danger` badge reading `exit ?`. Unknown is being presented as crashed. In practice node-pty always supplies a number and the board always records it, so the `null` path is off the shipped happy path (hence low confidence); but if it ever fires, "unknown" shouldn't wear the crash color. Extract the predicate to a single `const failed = !killed && session.exitCode != null && session.exitCode !== 0` and reuse it in both spots.

**N3. `status`/`reason` cross the server↔client seam as bare string literals with no shared constant** — `client/src/core/types.ts:18` · confidence 35

**Status:** Accepted as-is.
**Resolution:** Not remediated. The server (CommonJS, no build) and client (TS/ESM) are deliberately independent packages — a shared constants module would be the first cross-package runtime import, structural cost out of proportion to two literals. The seam's shape is already pinned where the repo pins such things (`types.ts` mirrors `toDto()`, with the loose `string` documented as intentional until attention-states widens it into a union — the natural point to revisit this). Both tiers' tests assert the literal wire values, which is the drift guard the note itself credits.

`'exited'` is produced in `sessions.js` (`endedToDto`), compared in `ws.js:42` (`existing.status === 'exited'`) to refuse the attach, and compared again in `SessionsScreen.jsx` (`s.status !== 'exited'` / `=== 'exited'`, live/ended partition + `liveCount`); `reason`'s `'killed'`/`'exited'` values are likewise stringly-compared on both tiers. A typo in any one comparison ("exit" vs "exited") silently mis-buckets a tombstone — e.g. a dead line would become attachable again in `ws.js`, or would be counted as live in the header — with no type error, because `types.ts` keeps `status`/`reason` as `string` (a *documented* choice: the attention-states proposal will widen `status`, so the loose type is intentional and **not** itself a finding). This note is about the literal *duplication* across the boundary, not the type: a small shared string-const module (or the eventual union) would collapse the drift surface. Low confidence — single-operator, single-repo, and the tests would likely catch a wire-value typo.

**N4. `sb`/MCP `list` now carry exit metadata they ignore, and `kill()`/DELETE quietly gained a second meaning** — `server/src/sessions.js:147` · confidence 30

**Status:** Accepted as-is.
**Resolution:** Not remediated. The `sb`/MCP half is an explicitly-scoped boundary the note itself acknowledges (the metadata is on the wire, free to surface when attention-states or an MCP release picks it up). On `kill()`: idempotent "make this session id go away" DELETE is reasonable REST, the fallthrough lives in exactly one commented spot, and CLAUDE.md's `src/sessions.js` entry names the `end` → `forget` fallthrough — which is where a maintainer hunting "where do tombstones get dismissed" will land.

Two small maintainer signposts, both deliberate for this feature's scope:

- The board's `list` reply now includes `ended` for *every* caller, but `sb` and `mcp-server` "read `r.lines` only" (board.js:325 comment) — so terminal-pane and agent users still see a killed line silently vanish, the exact gap this feature closed for the web tier. That's an intentional scope boundary, noted here only so a future reader knows the metadata is already on the wire and free to surface (it composes with `2026-07-02-session-attention-states.md`).
- `BoardSessions.kill()` (and the `DELETE /sessions/:id` it backs) now means both "terminate a live line" and "dismiss a tombstone" via the `end`→`forget` fallthrough (`:146-157`). The method name still says only "kill." It's well-commented and idempotent-DELETE is reasonable REST, so this is a naming NOTE, not a defect — but a maintainer scanning for "where do tombstones get dismissed" won't find it under any `forget`/`dismiss` symbol on the web tier; it's hidden inside `kill`.

### Summary

This is a clean, well-scoped, additive change: the tombstone ring is bounded (cap 20) and in-memory by design (the stated id-reuse hygiene), the `list` reply extends without breaking `sb`/MCP, the seam correctly refuses attach to a dead line (`ws.js:42`), and the DTO/kill-fallthrough/wire surfaces are all unit-tested with the older-board (`ended` absent) path explicitly covered. The single item worth acting on before merge is **W1**: the killed-vs-exited `reason` distinction — the feature's reason for existing — has no CI regression guard, only a manual e2e, so a refactor of the `end` handler's set-before-kill ordering would silently mislabel every operator kill as a crash with nothing failing. The notes are maintainability polish (DTO duplication, a duplicated client predicate, cross-seam string literals). Safe to merge; add W1's guard first if cheap.

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| ~~W1~~ | WARNING | 60 | killed-vs-exited `reason` invariant (endReason→onExit) has no automated test | ✅ Resolved in ad51a08 |
| ~~N1~~ | NOTE | 45 | `endedToDto` duplicates `toDto` field mapping + name fallback | ✅ Resolved in ad51a08 |
| ~~N2~~ | NOTE | 40 | client crash-predicate duplicated across 2 sites; treats `null` exitCode as error | ✅ Resolved in ad51a08 |
| ~~N3~~ | NOTE | 35 | `status`/`reason` compared as bare literals across server↔client, no shared const | Accepted as-is |
| ~~N4~~ | NOTE | 30 | `sb`/MCP ignore the new `ended`; `kill()`/DELETE silently also means "dismiss" | Accepted as-is |

**What's left:** 3 resolved, 2 accepted as-is, 0 deferred, 0 open.

## Verify pass (remediation)

**Range:** `1c764f9..d684080` (remediation `ad51a08` + doc annotations). **Verdict: CLEARED.**

- **W1** — falsified by mutation: with `s.endReason = 'killed'` deleted from the `end` handler, `tombstone.e2e.test.js` fails (`reason` comes back `'exited'`); restored, it passes. The guard genuinely trips on the regression class that matters — the assignment being dropped or skipped. One precision note: the review's specific "reorder after `pty.kill()`" scenario would *not* actually misbehave (onExit fires async, so a same-tick assignment after the kill still lands first); the test guards the observable invariant rather than the line order, which is the right contract.
- **N1** — `endedToDto` spreads `toDto(...)` with the exit-specific overrides listed after the spread; the pre-existing `lastActive comes from endedAt` assertion in `sessions.test.js` pins the override ordering.
- **N2** — single `failed` predicate feeds both dot and badge; `exitCode != null` renders unknown as neutral. Typecheck + client suite green.
- Fresh full run at close-out: server 87/87, client 37/37, typecheck clean.

## Review methodology

Run via the `adversarial-review` skill in **in-context mode** — the change is small (1 commit, 6 code files, ~200 reviewable lines) and, while it touches a security-relevant kernel, carries no new trust boundary (tombstones ride the same secret-gated pipes and token-gated REST as live lines; no new PHI, no new access-control surface, no credential storage — the `run` command is deliberately *not* recorded in the tombstone). So the standing trio (Saboteur, Maintainer, Security Auditor) ran sequentially rather than as isolated subagents; no conditional specialist was summoned (no DB, no data-sized loop, no hot path, no HIPAA identifiers). Constraints brief built from the feature's own design doc (`2026-07-02-session-exit-metadata.md`) and the repo CLAUDE.md, whose stated intents were treated as authoritative — so the in-memory-only ring (id-reuse hygiene), the additive-`ended`/`sb`-ignores-it decision, `status` staying a loose `string` until attention-states, and the tombstone-stays-tiny (transcript retention is a separate feature) are **by design, not findings**. Security Auditor surfaced no finding above NOTE level (closest security-relevant assumption: dead-session `cwd`/`name` persist in memory and are served to any token-holder for up to 20 sessions — acceptable in the documented single-operator, single-token model, and identical to the live-line disclosure). Mechanical pre-checks (both test suites, typecheck) run green before the persona pass; W1's gap and N2's `null`-exitCode path were traced directly against the source before scoring.
