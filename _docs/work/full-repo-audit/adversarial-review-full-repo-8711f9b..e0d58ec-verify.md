## Remediation Verification: full-repo-audit — 8711f9b..e0d58ec (round 3)

**Verifies:** `_docs/work/full-repo-audit/adversarial-review-full-repo-fbfa593..8711f9b-verify.md` (as annotated by round-3 interactive remediation at `e0d58ec3921cb85fe47fa22bfc2f3bc2fa22d5cf`)
**Range:** `8711f9b8642cada34418443b857839a033889144..e0d58ec3921cb85fe47fa22bfc2f3bc2fa22d5cf` (5 fix commits + 2 doc-annotation commits)
**Verdict:** CLEARED

This round-3 remediation was produced interactively (human-gated, one finding at a time), not by an autonomous batch pass — the same falsify-don't-confirm hostility standard applies regardless of production mode. Verified by three isolated hostile subagents, one per subsystem slice (board kernel; server web tier; client), each instructed to re-derive every claimed Resolution and closure check directly against the post-fix code in the existing remediation worktree (`.claude/worktrees/agent-a7e3b1968ebfbc145`, HEAD = `e0d58ec`, diffed against `8711f9b`) rather than trust the remediator's prose, and to sweep the fix diff for newly-introduced defects. The orchestrator independently re-read `server/board/mcp-server.js` in full and re-traced the `observeBoot`/`refreshBoot`/`endLine` mechanics by hand — this is the second verify pass on the C1 lineage (it was caught regressed once already in round 2), so it got the most scrutiny of anything in this range. Both server (32/32) and client (12/12) test suites were independently run and confirmed green at HEAD.

N1–N4 (new) were deliberately left open by explicit user scope decision this round ("fix the rest of the Ws") and carry no Status block in the annotated doc — they are **not** treated as claimed-resolved here; this pass only confirms they were not silently touched or regressed in scope.

---

### Close-out (round-3 remediation)

| Orig ID | Claimed | Verify verdict | Evidence |
|---------|---------|----------------|----------|
| **C1 (new, r2)** | Resolved (B — re-frame) — `1244bfb` | ✅ **Confirmed closed** (scoped; residual honestly disclosed, not silently closed) | `observeBoot(freshBoot)` (`mcp-server.js:53-58`) is called immediately after the RPC reply in both `switchboard_new_line` (`:187-188`) and `switchboard_list_lines` (`:201-202`), keyed off the reply's own `boot` field — verified `board.js`'s `'new'`/`'list'` replies always carry `boot: BOOT`. It clears `seen` and re-arms the TTL on any nonce change, closing the collision path for any read that follows a `new`/`list` call from this process. Traced every other tool (`switchboard_wait_for_idle`, `switchboard_send_input`, `switchboard_end_line`) — none of them touch `boot`/`seen` and none needed to. The one path that can't observe a mid-TTL restart — `switchboard_read_output` called with no intervening `new`/`list` call from this process, e.g. reading a line created via bare `sb new` — is exactly the residual the remediator disclosed, not a wider unnamed hole, and is not claimed closed anywhere in code or tests. Independently confirmed the regression tests are not vacuous: required the pre-fix `mcp-server.js` (`8711f9b`) directly — `observeBoot`/`endLine` are both `undefined` there, so `observeBoot (C1 re-corruption, round 2)` and `endLine (C1 leak, round 2)` fail hard pre-fix and pass post-fix. |
| **W1 (new, r2)** | Resolved (A) — `1244bfb` | ✅ **Confirmed closed** | `endLine(id)` (`mcp-server.js:152-158`) wraps `boardRpc({cmd:'end', id})` in `try { ... } finally { forgetLine(id) }` — `forgetLine` now runs unconditionally, including on rejection. `switchboard_end_line`'s handler (`:281-290`) calls only `endLine`; grepped the diff and current file for a second, un-migrated inline copy of the old pattern — none exists. The `boardRpc` seam consolidation (renamed from `probeRpc`, now shared by `refreshBoot`/`new_line`/`list_lines`/`endLine`) is a pure test-injection refactor — production default is unchanged (`(msg,opts)=>rpc(msg,opts)`) at every call site, so no real RPC behavior changed. |
| **N2 (new, r1)** | Resolved — "same root cause as new-C1, fixed by the same change" — `1244bfb` | ✅ **Confirmed obsolete** | Cross-checked against the annotated doc's own framing: N2(new,r1) and C1(new,r2) are the TTL-fast-path-trusts-a-cached-nonce root cause, and the code has exactly one mechanism (`observeBoot`) addressing both — no separate code path exists that N2 could still be open against. |
| **W2 (new, r2)** | Resolved (A) — `92cd1e7` | ✅ **Confirmed closed** | `SessionsScreen.jsx`'s `handleKill` now checks/adds a per-id `killingRef` `Set` synchronously before the first `await` (`:230-248`), cleared in a `finally` on every exit path. Confirmed Set-keyed (not a shared boolean) — killing two different sessions concurrently is unaffected, only a repeat click on the *same* id is blocked. Traced the double-click race by hand: the second click's synchronous prefix runs strictly after the first's, so it always observes the first's `Set.add` before either RPC fires. Confirmed the Terminate button's `onClick` actually routes through `handleKill` (`onKill={handleKill}` at the `SessionCard` call site), not a bypass straight to `killSession`. |
| **W3 (new, r2)** | Resolved (A) — `f7488dd` | ✅ **Confirmed closed**, real coverage not theater | `server/src/errorHandler.js` now holds the one real implementation (`headersSent` → `next(err)`, `boardUnreachable` → 503, else 500, no leaked detail), imported identically by both `server/index.js` (`app.use(errorHandler)`, old 12-line inline block fully removed — not a dual-copy trap) and `server/src/api.test.js`. Hand-traced the `headersSent`-true unit test against both the old and new handler bodies: it passes only against the fixed `next(err)` behavior and would throw its `assert.deepStrictEqual` against the old bare `return` — genuine differential coverage. |
| **W4 (new, r2)** | Resolved (A) — `cf85913` | ✅ **Confirmed closed**, real coverage not theater | `wsFrame.js`'s `isValidDataPayload` (`typeof msg.payload === 'string'`) correctly accepts an empty string (not a truthiness check that would wrongly reject `""`). `TerminalScreen.jsx:82`'s dispatch (`if (msg.type === 'data' && isValidDataPayload(msg)) onData(msg.payload)`) short-circuits before `term.write` is ever reached on a failing check — confirmed the helper is the actual gate, not dead code the call site ignores, so the helper-level tests are faithful integration coverage. A rejected frame is silently dropped, consistent with the file's existing convention for other malformed-frame cases, not a new silent-failure pattern. |

**N1–N4 (new) status — confirmed untouched, left open by design, not silently closed or regressed:**

| ID | File | Confirmed status |
|----|------|----|
| N1 (new) | `server/board/board.js:73` (`onData` broadcast loop) | Still unguarded, no try/catch. `git diff 8711f9b..e0d58ec` on `board.js`/`lib.js` is empty — zero changes to either file this round. |
| N2 (new) | `server/src/sessions.js:59-62` (test-injection constructor) | `sessions.js` not in this round's diffstat — byte-identical to `8711f9b`. |
| N3 (new) | `server/src/ws.js:25` | Not in this round's diffstat — byte-identical to `8711f9b`. |
| N4 (new) | `client/src/hostTrust.js:12` | Not in this round's diffstat — byte-identical to `8711f9b`. |

---

### New findings (introduced or exposed by round-3 remediation)

**N1 (new, r3). Sibling tool calls' `observeBoot` can clear the cursor cache mid-flight of an unrelated in-progress `readOutput`, causing duplicate (not lost) output redelivery** — `server/board/mcp-server.js:53-58` (`observeBoot`) interacting with `:100-136` (`readOutput`'s `finish()`) · confidence 50

`readOutput` captures its cache key once at the start of a call (`key = confirmed ? \`${b}:${id}\` : null`, line 106) and only reads `seen`'s current state later, at `finish()` (line 124), after waiting up to `maxWaitMs` (default 3000ms) for the pipe to go quiet. Before this round, the *only* trigger that could clear `seen` was `refreshBoot`'s own synchronous re-probe at the start of the same call — never a concurrent one. This round's fix intentionally broadens invalidation so it also fires eagerly from any sibling `switchboard_new_line`/`switchboard_list_lines` call that observes a new boot nonce (that's the whole point of `observeBoot` — catch a restart at the earliest possible moment). That broadening also widens the window in which an *unrelated* in-flight `readOutput` can have its cache entry cleared out from under it mid-wait: when its `finish()` eventually runs `advanceCursor(seen, key, text.length, pipeClosed)` against the now-cleared map, `already` resolves to `0` instead of whatever had genuinely already been delivered to an earlier caller, so the full accumulated text — including content a previous read of the same line already returned — is redelivered.

This is real but low-severity: it requires a genuine board restart landing inside another line's in-flight read window, and the failure mode is over-delivery (a reader sees repeated output), never the silent-truncation direction C1 was about — the safer of the two possible failure directions. Not blocking, but worth naming since it's structurally adjacent to the finding that was already regressed once in this feature.

**Fix:** capture `already` from the cache before entering the wait (at the same point `key` is captured), or make `advanceCursor` detect a mid-flight clear as a discontinuity rather than defaulting to 0 — or accept as an intentional, documented tradeoff (over-delivery over data loss).

---

**N2 (new, r3). `TerminalScreen.jsx`'s `exit` frame's `code` field has no payload-shape validation, unlike the now-guarded `data` frame** — `client/src/screens/TerminalScreen.jsx:83,187` · confidence 20

The `data` branch gained `isValidDataPayload` this round; the sibling `exit` branch (`if (msg.type === 'exit') { ... onExit(msg.code); }`) still passes `msg.code` straight into a template literal (`onExitRef.current`, line 187) with no type check. Not exploitable into a crash — template-literal interpolation coerces any value to a string safely — and the server only ever sends a real numeric exit code (`server/src/ws.js:43`), so this is cosmetic-display risk only, reachable only by a compromised or buggy relay. Included for completeness per the sweep, not because it's a real risk today.

**Fix:** optional — `Number.isFinite(msg.code) ? msg.code : 'unknown'`, or leave as-is given the severity.

---

### Summary

Round 3 closed every item it targeted: the C1 lineage — the highest-severity finding in the whole audit, already caught regressed once — is now genuinely closed for the collision path it re-frames around (any read following a `new`/`list` call from this process), with the narrower residual (a bare-`sb-new`-created line read within the leftover TTL with no intervening `new`/`list` call) honestly disclosed rather than silently claimed shut. W1/W2/W3/W4(new) are all confirmed closed with real, non-vacuous regression coverage — hand-verified against both the pre-fix and post-fix code, not just accepted from green CI. N1–N4(new) were correctly left untouched, matching the explicit scope decision for this pass. The sweep surfaced two new, non-blocking NOTEs: a subtle output-redelivery race the C1 fix's own broadened invalidation trigger opens up (safe-direction, low likelihood), and a cosmetic unguarded `exit.code` field. Neither rises to WARNING, let alone CRITICAL. **Safe to merge this worktree.**

---

## Priority ranking

Covers the **new findings** from this round's sweep only; the close-out table above carries the round-3-targeted finding verdicts.

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| N1 | NOTE | 50 | Sibling-call `observeBoot` can clear the cursor cache mid-flight of an unrelated `readOutput`, causing duplicate redelivery | (open) |
| N2 | NOTE | 20 | `exit` frame's `code` field has no payload-shape validation | (open) |

**Carried-forward open items (unchanged from round 2, left open by explicit user scope):** N1(new,r2) `board.js` `onData` broadcast loop unguarded; N2(new,r2) `sessions.js` constructor injection weakens the "single seam" guarantee; N3(new,r2) `ws.js` log-line framing; N4(new,r2) `hostTrust.js` scheme-regex assumption undocumented. All confirmed untouched this round — none block merge.
