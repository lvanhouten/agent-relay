## Remediation Verification: full-repo-audit — 7195eb1..fbfa593

**Verifies:** `_docs/work/full-repo-audit/adversarial-review-full-repo-7195eb1.md` (as annotated by remediation at `fbfa593a3bc58b1ee373fa571b2a061c5dcd3b1b`)
**Range:** `7195eb1..fbfa593a3bc58b1ee373fa571b2a061c5dcd3b1b` (21 remediation commits + 1 doc-annotation commit)
**Verdict:** RESIDUE

Verified by three isolated hostile subagents, one per subsystem slice (board kernel, web tier, client), each instructed to falsify every claimed Resolution against the actual post-fix code (read from the remediation worktree at `.claude\worktrees\agent-ab02b6d4807ee6ecf`, HEAD = `fbfa593`) rather than trust the remediator's prose, and to sweep the fix diff for newly-introduced defects. The orchestrator independently derived the residual C1 leak gap before delegating, and the board-kernel agent independently reached the same conclusion plus a second, more severe re-corruption path — convergent confirmation.

---

### Close-out (original findings)

| Orig ID | Claimed | Verify verdict | Evidence |
|---------|---------|----------------|----------|
| C1 | Resolved (A) — `1a166d3` | ⚠️ **Not closed** | Corruption (sub-defect 2) and the concurrency race (sub-defect 3) are genuinely fixed — the boot-nonce namespacing and `Math.max` monotonic advance both hold up under trace. Sub-defect 1 (the leak) is only *narrowed*, not closed: `mcp-server.js`'s `switchboard_end_line` tool never touches `seen` — a line ended via `end_line` without a subsequent `readOutput` call leaves its cursor entry orphaned until the next board-restart boot-nonce change (`mcp-server.js` end-line handler, ~line 211-214, vs. the cache at ~line 33). Worse, there's a real re-corruption window: `refreshBoot()` only updates the cached `boot` nonce on RPC *success* (`mcp-server.js:37-41`); if that probe fails/times out during the exact window of a board restart + id reuse + a leaked pre-restart entry, `readOutput` builds its cache key off the **stale** boot nonce (line 47) and collides with the orphaned entry — reproducing the original silent-truncation symptom the fix was meant to eliminate, just behind a narrower race. |
| C2 | Resolved (A) — `5ac451f` | ⚠️ **Not closed (partially)** | The specific defect named in C2 — `GET /api/sessions` and the WS pre-attach existence check silently treating board-down as "zero sessions" — is genuinely fixed: `list()` now throws `BoardUnreachableError`, `api.js` answers 503, `ws.js` closes 1013 vs 1008 correctly. But the same collapse pattern survives unfixed in the same file: `sessions.js` `spawn()` calls `rpc({cmd:'new',...})` with no try/catch at all — a board-down `POST /sessions` throws a bare `Error` that `api.js`'s `e.boardUnreachable` check doesn't recognize, so it 500s instead of 503s. `kill()` still does `.catch(() => null)` → `api.js` maps the resulting `false` to a permanent 404 — the exact "down looks indistinguishable from gone" bug C2 targeted, just relocated to `DELETE /sessions/:id`. |
| W1 | Resolved (A) — `e4ca986` | ✅ Confirmed closed | `isLocalhost()` fails closed on unparseable input; `ar-host-trusted` is written only after a genuinely successful probe (never on a failed one, so an attacker can't pre-trust their own origin); the second-click confirm re-derives its predicate from live state, so editing the host between clicks doesn't slip through. No circular import between `api.js` and `LoginScreen.jsx`. |
| W2 | Resolved (A) — `0470132` | ✅ Confirmed closed | Repo-wide grep under `client/` for `preview` (case-insensitive) returns only the unrelated `vite preview` npm script and the removal comment — no `TerminalPreview`/`session.preview` reference remains. Issue doc exists and is substantive. |
| W3 | Resolved (A) — `e4ca986` | ✅ Confirmed closed | `api.js` now exports `headers()`; `LoginScreen.jsx` imports and calls it instead of hand-building the Bearer header. Single source of truth confirmed. |
| W4 | Resolved (A) — `963d021` | ⚠️ **Not fully closed** | The try/catch/finally structure is correct — `setDialog(false)`/`onAttach` are genuinely inside the `try` after the await, and `finally { setCreating(false) }` resets the busy flag on both success and failure (no permanent lockout). But there is no synchronous re-entrancy guard (`if (creating) return;`) in `handleCreate` — it relies entirely on the `Button`'s DOM `disabled` attribute, which only takes effect after React commits the state update. A fast double-click before that re-render can fire two concurrent `createSession` calls. The fix's implicit claim (busy-guards double-submit) overstates what a DOM attribute alone guarantees. |
| W5 | Resolved (A) — `babe7b7` | ✅ Confirmed closed | `spawn()` builds its DTO exclusively through `toDto()` — no hand-built object remains; confirmed `toDto()` is the sole mapping shared by `list()` and `spawn()`. |
| W6 | Resolved (A) — `245406e` | ✅ Confirmed closed | Correct 4-arg error-handler signature, registered after all routes, `res.headersSent` guarded, `err.stack` logged server-side only and never leaked into the response body. |
| W7 | Resolved (A) — `619c1cd` | ✅ Confirmed closed | `lib.js`'s shared `rpc()` clears its timer on every terminal path via an idempotent `done()`; `sb.js`, `mcp-server.js`, and `board-client.js` all import the one helper — no local copies remain anywhere in the tree (grepped). |
| W8 | Resolved (A) — `94ac1dc` | ✅ Confirmed closed | `validateSpawnBody()` runs strictly before `sessions.spawn()`, covers all four fields, correctly rejects non-strings and over-length values; no other field reaches `pty.spawn` unvalidated. |
| W9 | Resolved (A) — `f152040` | ✅ Confirmed closed | Pure rename to `FEED_DEBOUNCE_MS`/`FEED_FALLBACK_MS`, identical call sites, no logic drift. |
| W10 | Resolved (A) — `b503aaa` | ✅ Confirmed closed | Traced the exact interleaving in the finding: the `seq < latestApplied` guard drops a stale poll response *before* the `killed` filter is even consulted, so early removal of a kill-mark by a fast reconcile-load can't let a stale response resurrect the session. Strict `<` (not `<=`) is correct since every `load()` call gets a unique monotonic seq. |
| W11 | Deferred (D) | ✅ Confirmed — parking justified | Issue doc exists and is substantive; independently confirmed `icacls` is filesystem-only and no DACL-inspection tool (AccessChk) is available on this machine — the "can't verify live" claim holds. |
| W12 | Resolved (A) — `07db618` | ✅ Confirmed closed | `isDim` guard correctly precedes both the `sizes.set` write and the `applyMin` fold; a garbage resize is dropped rather than propagating `NaN`. Not a regression that the drop stays silent — that matches pre-fix behavior (resize never `ack`s either way). |
| W13 | Resolved (A) — `babe7b7` | ✅ Confirmed closed | Board's `new` reply genuinely echoes the `cwd` it recorded (confirmed in `board.js`, not just claimed); `spawn()`'s `r.cwd ?? wd` fallback is self-consistent when it fires. |
| W14 | Re-framed (B) — `37c9267` | ✅ Confirmed closed (re-frame upheld) | The re-framing judgment is correct — the board's two-pipe architecture (existence check and attach are separate pipe connections) means no atomic call would actually close the window, it would just relocate it. The close-reason fix itself is verified empirically: a nonexistent Windows named pipe does emit `ENOENT` (tested directly on this machine), so the 1008 mapping fires correctly, after `connectPipe`'s ~2s retry budget exhausts (a latency note, not a correctness bug). `ECONNREFUSED` in the same branch is dead code on Windows for this failure mode but harmless. |
| N1 | Deferred (D) | ✅ Confirmed — parking justified | Issue doc exists; the vendoring claim is independently confirmed in `README.md`; the two `autostart.ps1` files are confirmed near-identical, differing only in `$TaskName`/target script. |
| N2 | Resolved (A) — `8e664dc` | ✅ Confirmed closed | The feed log line now records only length; grepped all `log()` call sites in `board.js` — none reference the raw `run` text. |
| N3 | Rejected (E) | ✅ Confirmed — reject justified | `SCROLLBACK=2000` remains the sole hard cap and `shift()` the only mutation site; the reject is correct on independent re-derivation, not a rubber stamp of the finding's own "not worth fixing" framing. |
| N4 | Resolved (A) — `c8b19c5` | ⚠️ **Not fully closed** | The try/catch wraps only `JSON.parse`, exactly as scoped — but code immediately after it assumes `msg` is a non-null object. `JSON.parse('null')` succeeds (doesn't throw) and returns `null`; the following `msg.type` access then throws uncaught inside `onmessage`, reproducing the exact "looks online, silently stops receiving" symptom the fix's own comment describes. A server (or an on-path party on this token-bearing channel) sending the literal WS text frame `null` triggers it. |
| N5 | Resolved (A) — `c8b19c5` | ✅ Confirmed closed | Comment block at the four ref declarations accurately describes the exhaustive-deps opt-out bridge; verified the underlying claim (callbacks excluded from the effect's deps) is true. |
| N6 | Resolved (A) — `8e664dc`/`619c1cd` | ✅ Confirmed closed | `lineClosedFarewell`/`EXIT_RE` have exactly one definition each in `lib.js`; every consumer (`board.js`, `wait.js`, `mcp-server.js`, `board-client.js`) imports rather than redefines — grepped the whole `server/` tree to confirm. |
| N7 | Resolved (A) — `9293398` | ⚠️ **Not closed — relocated** | Token-detection logic (standalone vs. embedded vs. absent) is correct. But the refusal is log-only: `openPane()`'s return value is discarded by both the `new` and `join` handlers, so the RPC reply is still `ok:true`/unconditional regardless of whether the pane spawned. This converts "spawns broken, silently fails" into "doesn't spawn, silently fails, plus an unread log line" — the defect's core complaint (silent failure, no caller-visible signal) is not resolved, just moved one step earlier. |
| N8 | Resolved (A) — `619c1cd` | ✅ Confirmed closed | Same shared `rpc()` extraction as W7; `RPC_TIMEOUT_MS=10000` genuinely bounds a hung board across all three consumers. |
| N9 | Re-framed (B/A) — `e0c3f08` | ⚠️ **Not fully closed** | The re-framing claim (fetch's rejection is genuinely indistinguishable across CORS/DNS/network-down in every major browser, no usable `error.cause`) is verified accurate, not overclaimed. But the new `new URL(h)` guard has a real gap in the opposite direction: `new URL('localhost:3017')` (bare host:port, no scheme — a plausible input given the placeholder shows the full form) does not throw; it parses with an empty hostname, so the malformed-host guard doesn't catch it, and `isLocalhost()` then misclassifies it as an untrusted remote host, showing the scary trust warning for what is actually the user's own machine. Fails safe (no token leak) but is a real usability regression in code this remediation introduced. |
| N10 | Resolved (A) — `8e664dc` | ⚠️ **Not closed — relocated** | The named crash site (malformed JSON field reaching `handle()`) is genuinely closed by the try/catch around the dispatch. But `p.onExit`'s `for (const c of s.clients) c.end(...)` loop is unguarded — a throw there is an uncaught exception in an async callback entirely outside this try/catch's scope, still capable of taking down the daemon. This gap predates the fix (not a regression), but the fix's implicit claim ("malformed input can't crash the daemon") is broader than what was actually closed. |
| N11 | Deferred (D) | ✅ Confirmed — parking justified | Issue doc lays out both directions (honor host for all traffic vs. remove/relabel) even-handedly with concrete fix outlines for each — not a dodge. |
| N12 | Resolved (A) — `4ba2077` | ✅ Confirmed closed | The cleartext predicate is combined via OR into the same single gate as W1, not a separate bypassable path; a non-localhost https+untrusted host still correctly triggers the trust warning even when the cleartext check alone is false. |
| N13 | Resolved (A) — `8e664dc` | ✅ Confirmed closed | Length check genuinely precedes `crypto.timingSafeEqual` (verified empirically — mismatched-length inputs never reach it, no DoS); non-string/null/undefined guarded before any `Buffer.from()` call. |
| N14 | Resolved (A) — `4ba2077` | ✅ Confirmed closed | `AR_CORS_ORIGIN` allowlist is passed to `cors()` in the shape the package expects (verified against the pinned `cors@2.8.6`); unset preserves the prior reflect-all default. |
| N15 | Deferred (D) | ✅ Confirmed — parking justified | Issue doc correctly frames this as a genuine product ambiguity (submit-per-line vs. block-paste), not an easy fix being dodged. |
| N16 | Deferred (D) | ✅ Confirmed — parking justified | Issue doc honestly scopes what was fixed (naming, redaction) vs. not (delivery confirmation, timer stacking). |

**Tally:** 20 Confirmed closed/justified · 7 Not closed or not fully closed (**C1, C2**, W4, N4, N7, N9, N10) · 5 Deferred confirmed appropriately parked (W11, N1, N11, N15, N16) · 1 Rejected confirmed correct (N3).

---

### New findings (introduced by the remediation)

**W1. `sessions.js` `spawn()` and `kill()` don't honor the `boardUnreachable` contract C2's fix just established** — `server/src/sessions.js` (`spawn()`, `kill()`) · confidence 65

`list()`/`get()` now throw `BoardUnreachableError` on board failure so `api.js` can answer 503; `spawn()`'s `rpc({cmd:'new',...})` call has no try/catch at all (throws a bare `Error`, which `api.js`'s `e.boardUnreachable` check doesn't recognize → 500 instead of 503), and `kill()` still does `.catch(() => null)` → `false` → `api.js` maps that to a permanent 404. Repro: stop the board, then `POST /api/sessions` (expect 503, get 500) or `DELETE /api/sessions/:id` (expect 503, get 404 "not found" for a session that may still be alive). This is the same defect *shape* C2 fixed, now inconsistent within the same file rather than uniformly broken.

**Fix:** Apply the same try/catch + `BoardUnreachableError` classification used in `list()`/`get()` to `spawn()` and `kill()`.

**W2. `EXIT_RE.test(text)` in `mcp-server.js`'s read path can false-positive on ordinary line output, not just the board's actual farewell** — `server/board/mcp-server.js` (`readOutput`'s `finish()`) · confidence 45

The cursor-deletion added by C1's fix keys off content-sniffing the *entire replayed stream* for the literal substring `closed (exit N)`, not an actual process-exit signal. If a running program prints or echoes that exact phrase (e.g. `cat`-ing a log file, or a user typing it), the cursor entry is deleted prematurely even though the line is still alive — the next read then re-delivers already-seen output as "new," reintroducing a narrower version of the exact corruption class C1 was fixing. `wait.js`'s use of the same regex is lower-risk (only consulted after the pipe already closed); `mcp-server.js` tests it against live, arbitrary shell output.

**Fix:** Gate the deletion on the pipe actually closing/erroring (which `readOutput` already distinguishes via its `sock.on('close')`/`sock.on('error')` handlers) rather than on content pattern-matching within a still-open stream.

**W3. `LoginScreen`'s new malformed-host guard doesn't recognize scheme-less shorthand, silently misdirecting a plausible input** — `client/src/screens/LoginScreen.jsx` (the `new URL(h)` guard added for N9) · confidence 40

`new URL('localhost:3017')` (bare `host:port`, no `http://`) doesn't throw — it parses with an empty hostname — so it passes the malformed check, then `isLocalhost()` misclassifies it as an untrusted remote host and shows the "haven't connected to this host before" warning for what is actually the user's own machine; the subsequent `fetch()` against that malformed absolute-URL string will also misbehave. The UI's own placeholder text (`http://localhost:3017`) makes a scheme-less abbreviation a realistic thing to type.

**Fix:** Normalize a bare `host[:port]` (no `://`) by prepending `http://` before both the `new URL()` validation and `isLocalhost()`/`fetch()` calls, or reject it explicitly with a clearer message than the generic malformed-host one.

**N1. `openPane`'s new refusal-to-spawn has no caller-visible signal** — `server/board/board.js` (`openPane` return value discarded by the `new`/`join` handlers) · confidence 50

N7's fix correctly detects the standalone-vs-embedded-`{cmd}` cases but only logs the refusal; the RPC reply for `new`/`join` is built independently of whether the pane actually opened, so a caller with a misconfigured `SWITCHBOARD_TERM` recipe gets `ok:true` while no terminal window ever appears — the same "reports success, nothing visibly happened" UX gap as before the fix, just moved from "wrong argv" to "no pane at all."

**Fix:** Thread `openPane`'s success/failure back into the `new`/`join` RPC reply (e.g. a `paneOpened: boolean` field).

**N2. `mcp-server.js`'s boot-nonce refresh adds a control-plane round-trip to every single `readOutput` call** — `server/board/mcp-server.js` (`refreshBoot()`, called unconditionally at the top of every `readOutput`) · confidence 40

Before C1's fix, `readOutput` went straight to the data pipe. Now every call first does a `list` RPC (bounded by the new 10s `RPC_TIMEOUT_MS`) before even attempting the data-pipe connection, whose own retry logic (3×50ms) would otherwise fail fast on a briefly-unresponsive board. Not a correctness bug, but a latency/load regression on the hot path of the tool's most-called operation.

**Fix:** Cache the boot nonce for a short TTL, or only re-probe it after observing a `readOutput` failure, rather than on every call.

**N3. Error-handling middleware doesn't call `next(err)` when headers are already sent** — `server/index.js` (final error handler, `res.headersSent` branch) · confidence 30

Express's documented pattern for this branch is to delegate to `next(err)` (letting the default handler clean up the connection) rather than bare-`return`. Low practical impact today since this is the last middleware in the chain, but it's a latent deviation that would matter if anything is ever chained after it.

**N4. `ws.js`'s new non-`boardUnreachable` catch branch (1011 close) has no server-side log line** — `server/src/ws.js` (the `get()` try/catch's fallback branch) · confidence 25

This branch is strictly better than the pre-fix behavior (an unhandled rejection), but unlike `sessions.js`'s own pattern (which logs the swallowed error), a non-`BoardUnreachableError` exception here closes the socket with zero diagnostic trail — an operator sees a closed connection with nothing to grep for.

---

### Summary

The remediation genuinely closed the large majority of the review — 20 of 32 findings hold up under hostile re-verification, including both security-relevant client fixes (W1's token-exfil guard, N13's constant-time comparison) and the maintainability consolidations (W7/N8's shared `rpc()`, W5/W13's single DTO mapping). All five parked deferrals and the one reject are independently justified, not rubber-stamped. But **both original CRITICALs are not fully closed**: C1's leak/corruption fix closes two of its three sub-defects solidly but leaves a real re-corruption window (stale boot nonce on a failed refresh probe colliding with an orphaned `end_line` entry) and an unaddressed leak path (`switchboard_end_line` never touches the cache) — independently reached by both the orchestrator and the board-kernel verification agent. C2's fix is airtight for `list()`/`get()` but the identical failure-collapse pattern survives untouched in `spawn()`/`kill()` in the same file. Three more findings (N7, N10, and a chunk of N4/N9) turned out to be *relocated* rather than *fixed* — the silent-failure characteristic the original finding named didn't go away, it moved one step over. The remediation's own new code also introduced four fresh low-to-moderate findings (a false-positive risk in C1's own exit-detection heuristic being the most notable). None of this rises to a new CRITICAL, so this is not a regression — but it is not clear to merge either.

---

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| W1 | WARNING | 65 | `spawn()`/`kill()` don't honor the `boardUnreachable` contract C2 established | (open) |
| W2 | WARNING | 45 | `EXIT_RE` content-sniffing can false-positive on live output, re-deleting a live cursor | (open) |
| W3 | WARNING | 40 | Malformed-host guard doesn't recognize scheme-less `host:port` shorthand | (open) |
| N1 | NOTE | 50 | `openPane` refusal has no caller-visible signal in the RPC reply | (open) |
| N2 | NOTE | 40 | Boot-nonce refresh adds a control-plane round-trip to every `readOutput` call | (open) |
| N3 | NOTE | 30 | Error handler doesn't `next(err)` when `headersSent` | (open) |
| N4 | NOTE | 25 | `ws.js`'s non-`boardUnreachable` catch branch is unlogged | (open) |

**Original findings still requiring attention (see Close-out table above for full evidence):** C1, C2 (both CRITICAL, not closed), W4, N4(orig), N7, N9, N10 (not fully closed / relocated).
