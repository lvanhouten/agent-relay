## Remediation Verification: full-repo-audit — fbfa593..8711f9b (round 2)

**Verifies:** `_docs/work/full-repo-audit/adversarial-review-full-repo-7195eb1..fbfa593-verify.md` (as annotated by round-2 remediation at `8711f9b8642cada34418443b857839a033889144`)
**Range:** `fbfa593a3bc58b1ee373fa571b2a061c5dcd3b1b..8711f9b8642cada34418443b857839a033889144` (9 fix commits + 1 doc-annotation commit)
**Verdict:** REGRESSED

Verified by three isolated hostile subagents, one per subsystem slice (board kernel, server web tier, client), each instructed to falsify every claimed round-2 Resolution against the actual post-fix code (read from the round-2 worktree at `.claude\worktrees\agent-a7e3b1968ebfbc145`, HEAD = `8711f9b`, diffed against the round-1 worktree at `.claude\worktrees\agent-ab02b6d4807ee6ecf`, HEAD = `fbfa593`) rather than trust the remediator's prose, and to sweep the fix diff for newly-introduced defects. All 34 tests in the round-2 suite (`server`: 24, `client`: 10) were independently confirmed green at HEAD before delegating. The orchestrator then independently re-traced the board-kernel agent's two most severe claims directly against `lib.js`, `mcp-server.js`, and `board.js` — both hold up under direct code inspection, not just the subagent's prose.

---

### Close-out (round-2 remediation)

| Orig ID | Claimed | Verify verdict | Evidence |
|---------|---------|----------------|----------|
| **C1** | ✅ Now resolved (A) — `eca67d4` | ❌ Regressed → ✅ **Resolved in `1244bfb`** (see new-C1's Status block — residual noted there, not silently closed) | Sub-defect 1 (leak) is still not closed: `switchboard_end_line`'s handler (`mcp-server.js:256-263`) does `const r = await rpc({ cmd: 'end', id }); forgetLine(id);` with **no try/finally**. `rpc()` (`lib.js:86-117`) rejects on timeout, socket error, malformed reply, or the board closing the connection early — all realistic during a board restart or a wedged line. On rejection, the `await` throws and `forgetLine(id)` is never reached, directly contradicting the code's own comment ("Do this regardless of the RPC result: even a failed/racy end shouldn't leave a stale cursor around"). Separately and more severely, the fix's own new TTL cache (added in the same commit to close N2-new) **reopens sub-defect 3**: `refreshBoot()` (`mcp-server.js:70-79`) returns `{boot, confirmed:true}` for up to `BOOT_TTL_MS=3000ms` purely from elapsed wall-clock time (line 71: `if (boot && Date.now() - bootTs < BOOT_TTL_MS) return {boot, confirmed:true}`), with **no re-probe of the live board**. A board restart inside that 3s window is invisible — `readOutput` keeps building its cache key off the pre-restart nonce as "confirmed," which is exactly the collision the fix's own comment at lines 63-69 says must never happen ("the caller MUST NOT key the cursor cache off an unconfirmed nonce... would collide and silently truncate"). Confirmed the collision precondition is realistic, not theoretical: `board.js:37` sets `BOOT = ${process.pid}-${Date.now()}` fresh per process, and `board.js:40` resets `seq = 0` on every board restart — so a post-restart line can reuse an id that collides with a pre-restart orphaned entry (created by sub-defect 1's leak, or any read that never observed pipe-close) under the still-cached stale key. |
| **C2** | ✅ Now resolved (A) — `04cb588` | ✅ Confirmed closed | `sessions.js`'s `spawn()` (`:83-112`) and `kill()` (`:114-127`) now try/catch `this._rpc(...)` and throw `BoardUnreachableError` on any RPC failure, while a *reachable* board's negative reply falls through to the existing distinct-failure path (`spawn`: plain `Error`; `kill`: `false` → 404). `api.js`'s DELETE handler now carries the same `e.boardUnreachable ? 503 : next(e)` branch as GET/POST. The `boardUnreachable` property is spelled identically at every throw/check site (grepped). `resize` (the only other RPC-adjacent call) is a fire-and-forget `ctrl.write()` through `board-client.js`'s `attach()` handle, intentionally outside the REST 503 contract — not a residual gap. |
| **W4** | ✅ Now resolved (A) — `15023d1` | ✅ Confirmed closed (for `handleCreate`) | `creatingRef.current` is checked and the early return (`SessionsScreen.jsx:205`) happens strictly before the synchronous `creatingRef.current = true` (206), itself before the first `await` — a real closed window, not a check-then-async-gap. Cleared in the same `finally` (219-220) on every exit path. The "named guarded path, no DOM test" closure is a legitimate substitute for this class of bug. **However**, the fix was scoped to `handleCreate` only — `handleKill` (`:226-240`), wired directly to the Terminate button's `onClick` with **no `disabled` prop and no ref guard at all**, has the identical (arguably worse) double-submit shape and was left untouched. Raised as new-W2 below. |
| **N4(orig)** | ✅ Now resolved (A) — `74cba7b` | ✅ Confirmed closed | `wsFrame.js`'s `parseFrame()` correctly rejects `null`, primitives, and unparseable JSON via `typeof msg !== 'object' \|\| !msg` (verified by direct execution of representative inputs); `TerminalScreen.jsx:80-84` checks `!msg` before any property access, on the only dispatch path in the file. Arrays deliberately pass through (`typeof [] === 'object'`) and are documented as a conscious no-op rather than an oversight (`wsFrame.test.js:29-34`) — correct as far as it goes, but see new-W4 below for the residual this narrows rather than closes. |
| **N7** | ✅ Now resolved (A) — `df3583d` | ✅ Confirmed closed | `openPane()` (`board.js:158-175`) returns `true`/`false`, threaded into both `new` (`:184`) and `join` (`:207`) replies as `paneOpened` (`true`/`false`/`null`, with `null` correctly scoped to "not requested" or "line doesn't exist" per call site). `sb.js` checks `r.paneOpened === false` strictly at both call sites — no state is silently miscoded as another. |
| **N9** | ✅ Now resolved (B/A) — `3cc97fa` | ✅ Confirmed closed | `hostTrust.js`'s `normalizeHost()` correctly distinguishes scheme-present from scheme-less input via `/^[a-z][a-z0-9+.-]*:\/\//i` (verified: no double-prepend on `http://`/`HTTPS://`, correct handling of `[::1]:3017`, safe degradation on empty/malformed input — all still throw `Invalid URL` downstream). Called exactly once at the top of `connect()`, and the resulting value is the sole input to every downstream check (malformed-host guard, `isLocalhost`, cleartext check, `fetch`, both `localStorage` writes) — no bypass path, including via a round-tripped `localStorage` value (always normalized before being saved). Verified fails safe against a userinfo-spoofing attempt (`localhost:3017@evil.com` → correctly resolves to untrusted `evil.com`). |
| **N10** | ✅ Now resolved (A) — `ba0e1ea` | ✅ Confirmed closed (for the cited loop) | `notifyClientsClosed()` (`board.js:116-118`) wraps each client `.end()` in its own try/catch and is called from `p.onExit` (`:81`) at the exact site that was previously unguarded; cleanup (`server.close()`/`sessions.delete()`, `:82-83`) runs unconditionally afterward even if every client throws. **However**, the structurally identical `onData` broadcast loop (`board.js:73`, `for (const c of s.clients) c.write(d)`) — hotter (fires per pty byte, not per line-exit) — remains unguarded and untouched. Lower practical risk than N10 was (pty data is always a Buffer/string, and sockets have durable `'error'` listeners), but it's the same shape the review explicitly named. Raised as new-N1 below. |

**Round-1-new findings assigned to round 2:**

| ID | Claimed | Verify verdict | Evidence |
|----|---------|----------------|----------|
| W1(new, r1) | ✅ Resolved `04cb588` | ✅ Confirmed closed | Bundled with C2 — see above. |
| W2(new, r1) | ✅ Resolved `eca67d4` | ✅ Confirmed closed | `EXIT_RE` content-sniffing fully removed from `mcp-server.js`'s cursor logic (`git grep` confirms zero hits outside `wait.js`'s unrelated exit-sentinel use and `lib.js`'s definition); cursor deletion is purely `pipeClosed`-gated. |
| W3(new, r1) | ✅ Resolved `3cc97fa` | ✅ Confirmed closed | Bundled with N9 — see above. |
| N1(new, r1) | ✅ Resolved `df3583d` | ✅ Confirmed closed | Bundled with N7 — see above. |
| N2(new, r1) | ✅ Resolved `eca67d4` | ❌ Regressed → ✅ **Resolved in `1244bfb`** | Same root cause as new-C1 below, fixed by the same change — see new-C1's Status block. |
| N3(new, r1) | ✅ Resolved `2a4a005` | ✅ Confirmed closed (code) | `server/index.js:37`'s `if (res.headersSent) return next(err);` is correct per Express's documented contract (delegates to the default handler, which destroys the connection rather than double-responding). **But no test exercises this line** — `api.test.js:13-25` builds a throwaway Express app with a hand-written duplicate error handler that still contains the *pre-fix* `if (res.headersSent) return;` and never imports/mounts the real `index.js`. Raised as new-W3 below. |
| N4(new, r1) | ✅ Resolved `2a4a005` | ✅ Confirmed closed | `ws.js:22-31`'s if/return structure makes the `console.error` and the `boardUnreachable` branches mutually exclusive by construction; no PHI/token leakage in what's logged. |

**Tally (updated after round-3 interactive remediation, `1244bfb`):** 14 of 14 round-2 items now closed — the 2 regressions (C1, N2-new, same root cause) resolved in `1244bfb`; see new-C1's Status block for the residual this fix does and does not cover.

---

### New findings (introduced or exposed by round-2 remediation)

**C1 (new). `refreshBoot`'s TTL short-circuit trusts a cached boot nonce without re-verifying it against the live board, reopening C1's silent-truncation corruption window** — `server/board/mcp-server.js:70-79` · confidence 80

**Status:** Resolved (B — re-frame) — see below.
**Resolution:** Round 2's fix was directionally right (namespace by boot nonce, TTL the re-probe for latency) but the TTL fast path had no way to learn of a restart inside its own window. Re-framed as: don't remove the TTL (that would reopen N2-new's latency concern), instead close the specific collision path by observing the boot nonce opportunistically from every reply that already carries one. Added `observeBoot(freshBoot)` (`mcp-server.js`), called from `switchboard_new_line` and `switchboard_list_lines` right after their existing RPC call — zero extra round-trips, since `boot` is already in those replies. The *only* way a client learns of an id that got reused post-restart is via a `new` or `list` reply, so this catches the restart before any read can reach the reused id.

**Stated residual, not silently closed:** this does not cover a line created via `sb new` entirely outside this MCP process and read within the same ≤3s TTL window with no intervening `list`/`new` call from this process — closing that fully means dropping the TTL, which reopens N2-new. Flagging this explicitly rather than claiming full closure; a future reviewer should treat this residual as accepted-tradeoff, not overlooked, unless the latency tradeoff is revisited.

Closure check: `mcp-server.test.js` — `observeBoot (C1 re-corruption, round 2)` proves a stale entry is dropped the instant a different boot is observed, independent of TTL freshness (fails without the fix: `observeBoot` didn't exist, the TTL path had no invalidation hook at all). Full server suite green (29/29). Commit: `1244bfb`.

---

`refreshBoot()`'s fast path (`if (boot && Date.now() - bootTs < BOOT_TTL_MS) return {boot, confirmed:true}`, line 71) reports `confirmed:true` based purely on elapsed time, not on any fresh signal from the board. If the board process restarts inside the 3-second TTL window, every `readOutput` call in that window keeps building its cursor-cache key off the pre-restart nonce, believing it "confirmed." Since `BOOT` (`board.js:37`) and `seq` (`board.js:40`) both reset on process restart, a freshly-spawned line can reuse an id that collides with an orphaned pre-restart cache entry under that same stale-but-"confirmed" key — reproducing the exact silent-truncation symptom the rest of this same commit (`eca67d4`) was written to close. The precondition (an orphaned entry existing under that key) is made concrete by new-W1 below, which shows the leak path that creates exactly such orphans.

**Fix:** Have `switchboard_new_line`'s RPC reply (which already carries a fresh `boot`, `board.js:186`) invalidate the TTL cache early, or don't extend "confirmed" trust past the single call that actually observed it — the TTL exists purely for hot-path latency and shouldn't be allowed to trade away the correctness guarantee the rest of the commit establishes.

---

**W1 (new). `switchboard_end_line` skips `forgetLine` when the underlying RPC rejects, leaving sub-defect 1's leak open on the exact failure path its own comment claims to cover** — `server/board/mcp-server.js:256-263` · confidence 90

**Status:** Resolved (A) — see below.
**Resolution:** Exactly the finding as framed. Factored the handler into an exported `endLine(id)` (`mcp-server.js`) wrapping the RPC call in `try { ... } finally { forgetLine(id); }`, so the cursor is dropped on both success and rejection. Factoring it out also fixed the underlying testability gap the finding named (no seam existed for the raw `rpc()` calls the tool handlers use) — the three tool handlers that talk to the board now share one injectable seam (`boardRpc`, was `probeRpc`) with `refreshBoot`.

Closure check: `mcp-server.test.js` — `endLine (C1 leak, round 2)` asserts `forgetLine` runs even when the RPC rejects (fails on the pre-fix code: no try/finally existed, so a rejecting mock would leave the cursor). Full server suite green (29/29). Commit: `1244bfb`.

---

`const r = await rpc({ cmd: 'end', id }); forgetLine(id);` has no try/catch/finally. `rpc()` (`lib.js:86-117`) rejects on timeout, socket error, malformed JSON, or premature connection close — all realistic during a board restart or a wedged line, which is precisely the scenario the adjacent comment calls out ("even a failed/racy end shouldn't leave a stale cursor around for a reused id"). On rejection, the whole tool handler rejects and `forgetLine` never runs, so the cursor entry leaks until the next observed boot-nonce change — and, per new-C1 above, can now collide with a reused id even sooner via the TTL cache. No test exercises this: `mcp-server.test.js` only unit-tests `forgetLine()` called directly, never the `switchboard_end_line` handler with a rejecting `rpc`.

**Fix:** `try { const r = await rpc(...); return {...}; } finally { forgetLine(id); }`.

---

**W2 (new). `handleKill` has the identical double-submit shape `handleCreate` was just fixed for, with no guard at all** — `client/src/screens/SessionsScreen.jsx:44-46, 226-240` · confidence 80

**Status:** Resolved (A) — see below.
**Resolution:** Exactly the finding as framed. Added a `killingRef` Set (per-id, not a single ref like `creatingRef` — killing two *different* sessions concurrently is legitimate; only a repeat click on the *same* id needs blocking), checked synchronously before the first `await`, mirroring `handleCreate`'s existing pattern.

Closure check: named guarded code path — the same standard the round-2 verify itself accepted for `handleCreate`'s identical fix ("no DOM test... legitimate substitute for this class of bug"); no component-rendering test harness exists in this repo. Full suite green (32 server, 12 client). Commit: `92cd1e7`.

---

The Terminate `IconButton`'s `onClick` (`:44-46`) calls `onKill(session.id)` directly with **no `disabled` prop passed** (unlike the original half-mitigated `handleCreate` bug — this one lacks even the DOM-disabled fallback) and **no ref guard**. A fast double-click fires two concurrent `killSession(id, ...)` calls against the same session id; the loser's error response is swallowed by a bare `finally` (`:238-239`) with no user-facing message. Same class of bug W4 named, on a file this round's remediation already touched, just not generalized to the sibling handler.

**Fix:** Apply the same `creatingRef`-style synchronous guard pattern to `handleKill`.

---

**W3 (new). `api.test.js`'s local error-handling middleware still encodes the pre-fix N3 behavior, so the real fix has zero regression coverage** — `server/src/api.test.js:13-25` · confidence 80

**Status:** Resolved (A) — see below.
**Resolution:** Extracted the real handler to `server/src/errorHandler.js`, imported by both `index.js` and `api.test.js` — one implementation, drift is no longer possible. Also added the missing branch coverage the finding named: 3 direct unit tests against the real export (mock `res`/`next`, no live HTTP request needed), including one that actually drives the `headersSent`-true path.

Closure check: `errorHandler: delegates to next(err) when headers are already sent` — fails against the old duplicate's `if (res.headersSent) return;` behavior (would call neither `status`/`json` nor `next`), passes against the real handler. Full suite green (32 server, 12 client). Commit: `f7488dd`.

---

This test file builds its own throwaway Express app with a hand-rolled error handler for test isolation, rather than mounting the real `server/index.js`. That duplicate was never updated when `2a4a005` fixed N3-new — it still reads `if (res.headersSent) return;` while the real `index.js:37` now reads `return next(err)`. The 24/24 green suite includes no coverage of the actual fixed line; a future "simplification" of `index.js`'s error handler (plausibly copying the pattern visible in this test file) would silently regress N3-new with no test failure.

**Fix:** Either import/mount the real `index.js` app in `api.test.js`, or add a dedicated assertion against the actual handler.

---

**W4 (new). `TerminalScreen.jsx`'s message dispatch trusts `msg.payload`'s shape once `msg.type` matches, reopening N4-orig's failure mode one field deeper** — `client/src/screens/TerminalScreen.jsx:82-83` · confidence 60

**Status:** Resolved (A) — see below.
**Resolution:** Exactly the finding as framed. Added `isValidDataPayload(msg)` to `wsFrame.js` alongside `parseFrame` (`typeof msg.payload === 'string'`), so the per-type payload guard is unit-testable the same way the envelope guard already is. Dispatch site now requires both `msg.type === 'data'` and `isValidDataPayload(msg)`.

Closure check: `wsFrame.test.js` — string payload accepted, object/number/null/missing payloads rejected (fails on the pre-fix dispatch, which had no such check). Full suite green (32 server, 12 client). Commit: `cf85913`.

---

`parseFrame` only guarantees "parsed to a non-null, non-array-excluded... actually non-null object" — it says nothing about the shape of a given `type`'s payload. `if (msg.type === 'data') onData(msg.payload)` passes `msg.payload` straight to `term.write()` (`:186`) with no type check; a well-formed-envelope-but-wrong-shaped frame (`{"type":"data","payload":{...}}`) either silently corrupts terminal output via string coercion or throws inside `xterm.js`'s `write()` — inside the same `onmessage` handler N4-orig's fix was written to protect. The object-shape gate was closed; the per-type field-shape gate was not.

**Fix:** Validate `typeof msg.payload === 'string'` (or the type-appropriate shape) before dispatch, not just that `msg` itself is an object.

---

**N1 (new). `board.js`'s `onData` client-broadcast loop remains unguarded, same shape as N10 but untouched** — `server/board/board.js:73` · confidence 40

`for (const c of s.clients) c.write(d)` has no try/catch, unlike its sibling `notifyClientsClosed`. Lower risk than N10 was in practice — pty data is always a Buffer/string (unlikely to trip `Writable.write()`'s synchronous validation throw) and each socket has a durable `'error'` listener attached at connection time — but it's the exact loop shape N10 asked to be checked for, fires far more often (every pty byte vs. once per line-exit), and wasn't touched.

**Fix:** Wrap in the same per-client try/catch as `notifyClientsClosed`, or share the helper.

---

**N2 (new). `sessions.js`'s test-injection constructor shadows the module's "single seam" claim** — `server/src/sessions.js:59-62` · confidence 55

`constructor({ rpc: rpcFn = rpc, attach: attachFn = attach } = {})` exists purely to inject fakes in tests, but nothing stops a production caller from constructing `new BoardSessions({ rpc: somethingElse })` and bypassing `board-client.js`'s `rpc()` — the file's own header comment calls that the sole seam where the board's vocabulary is spoken. Functionally correct today (all internal call sites were correctly renamed to `this._rpc`/`this._attach`), but the architectural guarantee is now convention-only, not construction-enforced.

**Fix:** Not urgent; consider a test-only factory function instead of a public constructor parameter if this needs tightening later.

---

**N3 (new). `ws.js`'s N4-new log line is narrower than its own framing — some "surprising" cases are logged one layer down instead** — `server/src/ws.js:25` · confidence 40

A non-ok-but-reachable `list()` reply throws a plain `BoardUnreachableError` (`sessions.js:73`) with no `cause`, indistinguishable from a genuine board-down failure once caught in `ws.js`. That case is already logged in `sessions.js:73` itself, so nothing is silently lost — but a reader of `ws.js` alone would believe its own `console.error` covers every unexpected case, when some are actually logged a layer below.

**Fix:** Optional — note in a comment that some "surprising" cases are logged upstream in `sessions.js`.

---

**N4 (new). `hostTrust.js`'s scheme regex requires `://` specifically, an undocumented assumption** — `client/src/hostTrust.js:12` · confidence 30

`/^[a-z][a-z0-9+.-]*:\/\//i` doesn't match scheme-only URIs without `//` (e.g. `mailto:`, `javascript:`), so such input gets `http://` prepended. Verified this degrades safely (`http://javascript:alert(1)` parses as an inert opaque path, no execution) — not currently exploitable, but the `://`-required assumption isn't documented and a future loosening of the regex could change that calculus.

**Fix:** A one-line comment noting the `://` requirement is deliberate (rejects scheme-only URIs by design).

---

### Summary

Round 2 genuinely closed 12 of the 14 items it targeted, including the security-relevant host-normalization fix (N9/W3-new) and the board-down/404-vs-503 contract (C2/W1-new), both confirmed via independent code tracing rather than trusting the Resolution prose. **But C1 — one of the two original CRITICALs — is not actually closed; it's regressed.** The same commit that closed C1's original two sub-defects also introduced the fix for N2-new's latency concern (a 3-second TTL on the boot-nonce probe), and that TTL reopens exactly the re-corruption window C1's own fix had just sealed: a board restart inside the TTL window is invisible to `readOutput`, which keeps trusting a stale nonce as "confirmed." Compounding it, sub-defect 1 (the cursor leak on `switchboard_end_line`) is still open on the RPC-failure path — the code's own comment describes the intended behavior, but the implementation has no try/finally to deliver it, so a failed `end` call leaves exactly the kind of orphaned entry the TTL bug needs to collide with. Both defects were independently re-traced by the orchestrator directly against the code (not just accepted from the subagent), including confirming the board's boot-nonce and sequence counter both reset on restart, making the collision realistic rather than theoretical. This is not a cosmetic residue — it's a genuine regression of the highest-severity finding in the whole audit, plus three more real (if lower-severity) gaps in touched files that mirror findings this same review cycle already named once (handleKill's double-submit, the onData broadcast loop, TerminalScreen's field-shape trust). **Do not merge this worktree.** The fix needs another pass on `mcp-server.js`'s cursor lifecycle specifically — likely dropping the TTL fast-path's blanket `confirmed:true`, or invalidating it against `switchboard_new_line`'s own fresh `boot` value — before C1 can be called closed.

---

## Priority ranking

Covers the **new findings** from this round's sweep only; the close-out table above carries the original/round-1-new finding verdicts.

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| ~~C1~~ | CRITICAL | 80 | `refreshBoot`'s TTL short-circuit reopens C1's re-corruption window | ✅ Resolved in `1244bfb` |
| ~~W1~~ | WARNING | 90 | `switchboard_end_line` skips `forgetLine` on RPC rejection | ✅ Resolved in `1244bfb` |
| ~~W2~~ | WARNING | 80 | `handleKill` has no double-submit guard (same shape as W4) | ✅ Resolved in `92cd1e7` |
| ~~W3~~ | WARNING | 80 | `api.test.js`'s duplicate error handler gives zero coverage for N3-new | ✅ Resolved in `f7488dd` |
| ~~W4~~ | WARNING | 60 | `TerminalScreen.jsx` trusts `msg.payload` shape without validation | ✅ Resolved in `cf85913` |
| N1 | NOTE | 40 | `board.js`'s `onData` broadcast loop remains unguarded (same shape as N10) | (open) |
| N2 | NOTE | 55 | `sessions.js` constructor injection weakens the "single seam" guarantee | (open) |
| N3 | NOTE | 40 | `ws.js`'s N4-new log line narrower than framed | (open) |
| N4 | NOTE | 30 | `hostTrust.js` scheme regex assumption undocumented | (open) |

**What's left (as of `cf85913`):** Resolved: C1, W1, W2, W3, W4 (round-3 interactive pass, commits `1244bfb`, `92cd1e7`, `f7488dd`, `cf85913`). Open: N1, N2, N3, N4 — all NOTE severity, none block-merge, left as-is per the user's explicit scope for this pass ("fix the rest of the Ws"). Re-review recommended before merge: an independent verify over the full round-3 range (`8711f9b..cf85913`) covers all four fixes as new code the original panel never saw.

**Original findings requiring another remediation pass:** C1 (regressed — leak + re-corruption both need fixing in `mcp-server.js`), N2-new (same root cause as C1, closed once C1 is).
