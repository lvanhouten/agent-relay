## Adversarial Review: extract-client-core branch vs main

**Scope:** 23 files changed (+762/-309) across 5 commits — the client-core extraction (`client/src/core/`: `useSessionWS`, `useSessions`, `sessionGuards`, `TerminalView`, `api`/`wsFrame` converted to TS), an unrelated `free-port.js` IPv6 fix, and doc-only commits.
**Reviewed:** `3bd5d96..1711f60` (merge-base `main`..`HEAD`), working tree clean.
**Pre-checks:** full client test suite (18/18), `tsc --strict` on `src/core` (0 errors), full server test suite (76/76) — all pass. No mechanical issues open.
**Verdict:** CONCERNS

### Warnings

**W1. IPv6 netstat fix can silently disable IPv4 port detection too** — `scripts/free-port.js:20-45` · confidence 60

**Status:** ✅ Resolved in 8dda607.
**Resolution:** Accepted as framed — the reviewer's proposed fix applied verbatim: each protocol's `execSync` now catches independently inside the `.map` callback, returning `''` for a failed stack, so a `tcpv6` failure can no longer erase the `tcp` results (and vice versa). The comment above the query names the guarded failure mode. Closure check: live smoke test — an IPv4-only listener on `127.0.0.1:3017` and an IPv6-only listener on `[::1]:5173` spawned, `node scripts/free-port.js 3017 5173` killed both and the ports verified free; the per-proto catch is the named guarded path for the can't-force-netstat-to-fail half.

---

The Windows branch now queries both `tcp` and `tcpv6` via `['tcp','tcpv6'].map(proto => execSync(...)).join('\n')`, all inside one try/catch. `Array.prototype.map` evaluates eagerly, so if the `tcpv6` call throws (IPv6 disabled/unsupported on the box, `netstat` syntax variance, etc.), the already-successful `tcp` output is discarded along with it and the function returns `[]` — no pids, no error surfaced. Before this change a `tcp`-only failure mode was the only one that existed; now a second, independent command can take down detection for both stacks. Worst case: `predev` silently stops killing even plain IPv4 orphans, reintroducing the `EADDRINUSE` this guard exists to prevent.

*Evidence:* `scripts/free-port.js:20` opens the try; lines 25-27 build `out` by mapping `execSync` over `['tcp', 'tcpv6']` and joining; line 43 is the single catch (`return [];`) covering both calls. No per-protocol isolation exists.

*Verdict basis:* CONFIRMED by the Saboteur persona (independently corroborated by the orchestrator's own read of the file before spawning personas).

*Fix:* catch each `execSync` call independently (`try { ... } catch { return ''; }` inside the `.map` callback) so one stack's failure can't erase the other's results.

```js
const out = ['tcp', 'tcpv6']
  .map((proto) => { try { return execSync(`netstat -ano -p ${proto}`, { encoding: 'utf8' }); } catch { return ''; } })
  .join('\n');
```

**W2. Extracting the create() re-entrancy guard moved `setCreateError('')` ahead of it — not byte-identical** — `client/src/screens/SessionsScreen.jsx:178` (guard now in `client/src/core/useSessions.ts:54-64`) · confidence 55
*(Promoted from NOTE to WARNING — the Maintainer and Saboteur lenses converged on this independently, from different angles: hidden-coupling risk vs. behavioral-parity gap.)*

**Status:** ✅ Resolved in f282b59.
**Resolution:** Accepted; resolved via the reviewer's second offered fix (the comment, not the reorder). The parity gap is real but its only observable effect today is re-clearing an already-cleared error string, and the reorder alternative would complicate `create()`'s return contract (a discriminated "dropped vs attempted" result) to protect against a hypothetical. Instead `handleCreate` now carries a comment stating the fact both personas flagged: the re-entrancy guard lives inside the hook, code above the `if (!session)` check runs on dropped calls too, and future side effects must go below it. Closure check: the named guarded path — the comment sits directly on the hazard line in `SessionsScreen.jsx`; no behavior changed, suite stays 18/18. The extraction issue doc's byte-identical claim was already softened by this review; the deviation is now documented at the seam itself.

---

Pre-extraction, `handleCreate` checked `if (creatingRef.current) return;` before touching any state, so a guard-dropped double-click was a true no-op. After the move, `SessionsScreen.jsx` unconditionally calls `setCreateError('')` before `await create(opts)`, and the re-entrancy check now lives inside the hook's `create()`. A dropped call today still clears `createError` — currently unobservable (it's already blank from the first click's own clear), but the guard's position is no longer visible to a reader of `handleCreate`, and a future addition placed before the `if (!session) return` line (analytics, an optimistic list mutation) would silently fire on every dropped click too, not just the genuine attempt.

*Evidence:* Old code (deleted lines visible in `git diff main...HEAD -- client/src/screens/SessionsScreen.jsx`, ~lines 760-786): `if (creatingRef.current) return;` is the first statement in `handleCreate`, before `setCreateError('')`. New code: `setCreateError('')` runs unconditionally at the top of `handleCreate`; the equivalent guard is now `if (creatingRef.current) return null;` inside `useSessions.ts`'s `create()` (lines 54-64), called only after the error is already cleared.

*Verdict basis:* CONFIRMED by both Maintainer persona (confidence 45) and Saboteur persona (confidence 60), reached independently without seeing each other's output.

*Fix:* `_docs/issues/2026-07-02-extract-client-core.md` explicitly commits this refactor to byte-identical behavior. Either reorder so `setCreateError('')` only runs once a genuine attempt is confirmed (requires `create()` to return a discriminated result distinguishing "dropped" from "attempted"), or — given the negligible practical impact — leave a comment in `handleCreate` noting that `create()` may no-op via the hook's internal guard and that anything placed before the `if (!session) return` line will run on a dropped call too.

### Notes

**N1. `load` exposed on the public `Sessions` interface with no doc comment or current consumer** — `client/src/core/useSessions.ts:9` · confidence 40

**Status:** ✅ Resolved in ef71a50.
**Resolution:** Accepted; resolved by documenting rather than dropping. `load` stays on the surface deliberately — the extraction exists to serve second consumers (desktop shell sidebar, mobile pull-to-refresh), and a manual refresh is a foreseeable first ask. The interface member now carries a doc comment stating it's safe to call externally (re-enters the same sequence guard and kill-suppression filter as the poll, so it can't stomp a newer result) and that the poll effect is its only current caller. Closure check: the comment on the interface member is the deliverable; no behavior changed, suite 18/18, typecheck clean.

---

`create` and `kill` both document their resolution/rejection semantics on the `Sessions` interface; `load` (line 9) has no comment, and its only consumer, `SessionsScreen.jsx`, destructures `{ sessions, create, kill, creating }` and never calls it — it's wired internally to the 5s poll interval only. A future maintainer looking at the public hook surface has no signal for whether `load()` is meant to be called for a manual "refresh" affordance (it re-enters the same `pollSeq`/`filterKilled` guards, so it's probably safe) or is only exposed as an implementation leak that happens to satisfy TypeScript.

*Verdict basis:* PLAUSIBLE — raised solo by the Maintainer persona.

*Fix:* either drop `load` from the returned/public `Sessions` shape if it's not meant to be called externally, or add a one-line comment on the interface member documenting that it's safe to call for a manual refresh and re-enters the same poll guards.

**N2. Exit frame's `code` field uses an unchecked type assertion, unlike its sibling `data` field** — `client/src/core/useSessionWS.ts:462` · confidence 35

**Status:** ✅ Resolved in <N2 gate SHA>.
**Resolution:** Accepted; the reviewer's proposed fix applied with one deliberate semantic: `isValidExitCode(msg): msg is { code: number | null }` now guards the field in `wsFrame.ts` (mirroring `isValidDataPayload`), but unlike the data path — where an invalid frame is dropped — an exit frame still always ends the session, with an invalid code *normalized to null* rather than the frame ignored. Gating the whole exit handling on the predicate would strand the client reconnecting to a dead line; only the value is validated before it reaches the render sink. This slightly changes output for a malformed frame ("code null" instead of "code undefined") — accepted as the point of the fix. Closure check: red→green — `isValidExitCode` tests in `wsFrame.test.ts` (numeric/null accepted; missing/string/object rejected) fail without the new predicate and pass with it; suite 20/20.

---

`onmessage` validates the `data` frame's payload via the runtime predicate `isValidDataPayload` before trusting it (`client/src/core/wsFrame.ts`), but the `exit` frame's `code` field gets only `as number | null` — a compile-time assertion, not a runtime check — applied to a value taken straight from `parseFrame`'s `Record<string, unknown>` envelope. `wsFrame.ts` exists specifically to stop an unvalidated field from reaching a rendering sink unchecked; `code` is the one field in the vocabulary that skips that pattern. Currently benign because `server/src/ws.js:49` only ever forwards a real Node child-process exit code (always `number | null`), and the diff's own comment ("cast, not coerce... the envelope guard doesn't validate per-type fields") makes this an acknowledged decision rather than an oversight. Risk is forward-looking: a later change that does more than string-interpolate `code` (arithmetic, indexing, a `switch`) would trust the assertion instead of validating.

*Verdict basis:* PLAUSIBLE — raised solo by the Security Auditor persona.

*Fix:* add a small runtime guard (e.g. `isValidExitCode(msg): msg is {code: number|null}` mirroring `isValidDataPayload`'s shape) and use it the same way `isValidDataPayload` is used, instead of `as number | null`.

### Pre-checks performed (all clean, not findings)

- `npm test --workspace=client` — 18/18 pass, including the new `sessionGuards.test.ts` and the renamed `wsFrame.test.ts`.
- `npm run typecheck --workspace=client` (`tsc -p tsconfig.json`, `strict: true`, scoped to `src/core`) — 0 errors.
- `npm test --workspace=server` — 76/76 pass (unaffected by this diff, run to confirm no cross-package regression from the `free-port.js` change).
- Line-by-line trace of every moved/extracted function (`useSessionWS`, `sessionGuards`'s `createPollSequence`/`filterKilled`, `xtermThemes`, `TerminalView`'s mount effect, `wsFrame`'s `parseFrame`/`isValidDataPayload`) against its pre-extraction original in `git diff main...HEAD` — confirmed behaviorally identical except for W2 above.
- `TerminalView.tsx`'s `mode` prop (declared in the props interface, never destructured/read in the component body) is a deliberately stubbed contract for a future `spectator` mode per `_docs/issues/2026-07-02-extract-client-core.md` and an inline comment — not a finding.
- The `useSessions` guards (`pollSeq`, `killed`, `creatingRef`, `killingRef`) are refs rather than state, matching the extraction doc's explicit requirement that they be "ported as-is" — not a finding.

### Summary

The extraction itself is clean — every hook/component move traced line-by-line against its pre-extraction original is behaviorally identical, and all three personas independently confirmed the WS-frame trust boundary and the poll/kill guards ported intact. The two real findings are outside that core move: **W1** is a genuine regression risk in the unrelated `free-port.js` fix (two independently-fallible commands sharing one catch), and **W2** is a minor, currently-inert parity gap introduced by where the re-entrancy guard landed during the `useSessions` extraction. Neither blocks merge, but W1 is worth a quick fix since it's cheap and defeats its own purpose under a plausible config.

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| ~~W1~~ | WARNING | 60 | free-port.js: shared try/catch lets a tcpv6 failure erase tcp results too | ✅ Resolved in 8dda607 |
| ~~W2~~ | WARNING | 55 | setCreateError('') now runs ahead of the re-entrancy guard it used to follow | ✅ Resolved in f282b59 (comment) |
| ~~N1~~ | NOTE | 40 | `load` on `Sessions` interface undocumented, no consumer | ✅ Resolved in ef71a50 (comment) |
| ~~N2~~ | NOTE | 35 | exit frame `code` trusted via type assertion, not runtime predicate | ✅ Resolved (SHA in Status block) |

**What's left:** 4 resolved, 0 deferred, 0 rejected, 0 open.

## Review methodology

Run via the `adversarial-review` skill in fan-out mode: three isolated `review-persona` subagents (Saboteur, Maintainer, Security Auditor — the standing panel; no DB/HIPAA surface in this diff, so no conditional specialists were summoned), each given the full diff, a file-map, and a constraints brief built from `_docs/issues/2026-07-02-extract-client-core.md` (this change's own design doc, which commits it to a pure, byte-identical refactor). The orchestrator ran the mechanical pre-checks (tests, typecheck) before spawning personas, then deduplicated and confidence-scored the returned findings, promoting one (W2) a tier on genuine distinct-lens convergence.
