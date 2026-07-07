# Remediation Verification: backlog review — `a19a39a..89630ca`

**Verifies:** the remediation annotated across `_docs/work/backlog-review/adversarial-review-a19a39a-{static,attention,notify,qol,rdp,seams}.md` (the seams doc is the index; the fixes span all six).
**Range:** `a19a39a..89630ca` (branch `fix/backlog-review-remediation`, 22 commits)
**Verdict:** RESIDUE

Baseline established before review: 216 server tests, 97 client tests, `tsc` typecheck — all green.

Mode: fan-out. Saboteur / Maintainer / Security Auditor ran as isolated `review-persona` agents (Saboteur + Security on Opus), each doing per-finding close-out (falsify the fix) plus a new-defect sweep in its domain, blind to each other. The orchestrator ground-checked the four highest-stakes fixes directly (notify W5 origin gate, rdp W1/W2/N5 PowerShell, and the W3 residual) against HEAD. No specialist lens (Capacity Planner / Forensic Auditor) was triggered — the fix diff adds no DB/hot-path surface and no PHI passthrough (notify explicitly caps and disables the only egress fields).

## Bottom line

The remediation is substantively sound: **28 of 29 actively-fixed findings are confirmed closed**, including every security fix under direct adversarial attack. One finding — **notify W3** — is **not closed**: the applied fix (drop the `?.`, one of the two remedies the original reviewer offered) does not achieve the finding's actual goal, because the enclosing catch still swallows the failure. It is a latent maintainability trap gated on a *future* rename, not a live bug, and the fix is one line. RESIDUE rather than CLEARED on that single row; nothing here is worse than before, so not REGRESSED. Merge is a judgment call the user owns — W3's residual can be a quick follow-up commit or an accepted NOTE.

## Close-out (actively-fixed original findings)

| Orig ID | Claimed | Verify verdict | Evidence |
|---------|---------|----------------|----------|
| **static W1** | Fixed (A) | ✅ Confirmed closed | `static.js:59-63` fallback `next()`s for `isReservedPath` \|\| `/assets/` \|\| `/\.[^/]+$/`. Probed trailing-slash, dot-in-mid-segment (`/v1.2/settings`→nav), uppercase `/ASSETS/`, `/favicon.ico`→404. No client router exists, so no extensionless deep-link is wrongly 404'd. |
| **static W2** | Fixed (A) | ✅ Confirmed closed | `RESERVED_PREFIXES` + `isReservedPath()` exported (`static.js:13-25`), consumed by the fallback (not dead); `index.js:58-61` mount comment directs route-adders to the list. |
| **static N1** | Fixed w/ W2 | ✅ Confirmed closed | `isReservedPath` lowercases `req.path`; `/API/bogus`, `/Sessions`, `/SESSIONS/x` all → 404. Test pins `/API/unknown`. |
| **static N2** | Fixed (comment) | ✅ Confirmed closed | Comment-only scope-out in `createStatic` docstring; honestly framed (deploys restart the server). No behavior change. |
| **attention W1** | Fixed (A) | ✅ Confirmed closed | `core/attention.ts` `attentionFor()` is the single decode point; `SessionsScreen.jsx:93-98` consumes it; grep shows no leftover inline table. Tests pin 3 statuses + fallback + warn-once. |
| **attention N1** | Fixed w/ W1 | ✅ Confirmed closed | `attention.ts` unknown status *always* returns `{dot:'error',pulse:true,label:status}`; the `warned` Set gates only the `console.warn`, never the returned view — an unknown live status can never render as a dead offline dot. |
| **attention N2** | Fixed (A) | ✅ Confirmed closed | `sessions.js:38` `Number.isFinite(line.idleMs) ? … : 0` (non-coercing) feeds both status derivation and `relTime`; NaN/∞/null/string all → `running` + numeric time. Test pins it. |
| **notify W1** | Fixed (A) | ✅ Confirmed closed | `notifiers.js:80-84` logs every rejected sink; `pushoverNotifier` throws on non-2xx (`:50`) so a 429/timeout/revoked-token becomes a rejected settle → logged. No `ok:false`-without-log path exists among real sinks. |
| **notify W2** | Fixed (A) | ✅ Confirmed closed | One `validateFieldCaps(body, caps)` (`api.js:16-24`); both validators delegate; grep for `Object.entries(` in `server/` returns only this file — no residual copy. Layered notify rules intact. |
| **notify W3** | Fixed (B) | ⚠️ **Not closed** | See **W1** below. `?.` removed and call moved after `handle.write` (real: keystroke no longer lost), but `ws.js:88`'s `clearAttention(id)` sits inside the `catch { /* malformed message — ignore */ }` (`:78`,`:91`) — a future missing/renamed method throws a `TypeError` that is swallowed with nothing to grep for. The discoverability defect the finding actually named persists. |
| **notify W4** | Fixed (A) | ✅ Confirmed closed | README recipe pipes shell-builtin `printf` into `curl -K -`; token rides stdin config, absent from every argv. |
| **notify W5** | Fixed (A) | ✅ Confirmed closed | `validateNotifyUrl` (`api.js:58-67`) default-denies on unset `AR_NOTIFY_URL_ORIGIN` (`index.js:34` fails safe → deny), compares parsed `URL.origin` (not prefix) on the *same* `body.url` that's forwarded (`:135`). Attacked userinfo (`allowed@evil.com`→`evil.com` rejected), backslash-authority, opaque schemes (`javascript:`/`data:`→`null` rejected), http downgrade, trailing-dot host, uppercase scheme — all rejected or stay on-origin. Could not break it. |
| **notify N1** | Fixed (id-reuse) | ✅ Confirmed closed | `sessions.js:189-192` clears `_attention` only when `r.boot !== _boardBoot && _boardBoot !== null` — first sight preserves a just-set flag; board emits `boot` nonce (`board.js:330`). Reused-id inheritance killed; older board without `boot` → stable no spurious clears. Test pins both. |
| **notify N4** | Fixed (A) | ✅ Confirmed closed | cwd tests observe through `statusById()`/`list()`; only two `_attention` accesses survive, each commented as memory-hygiene (no public observation exists). |
| **notify N5** | Fixed (comment) | ✅ Confirmed closed | Comment-only at `_applyAttention` (`sessions.js:164-171`); text matches the logic (ordering assumption, repaint-race failure, soft blast radius, grace-window hatch). |
| **qol W1** | Fixed (A) | ✅ Confirmed closed | `useSessionWS.ts:107-112` `send()` returns `true` only inside the `readyState===OPEN` branch; `submitComposer` clears only on truthy return; Send+chips disabled off `connStatus`. The boolean (not the disable) closes the status-vs-socket race — even the Enter path can't eat text. |
| **qol W2** | Fixed (A) | ✅ Confirmed closed | All edit paths route through `editName`/`editCwd`/`editCommand` (reset `justSaved`) — three Inputs, quick-command pick, both `FlagChipRow`s (`SessionsScreen.jsx:212-217,327-381`). No bypass. |
| **qol W3** | Fixed (A) | ✅ Confirmed closed | Reconnect branch (`TerminalView.tsx:119-121`) clears decorations + emits `{resultIndex:-1,resultCount:-1}` through `onSearchResultsRef` → `searchReadout` renders `''`. Explicit emit is the last synchronous write, so no stale "3/5". |
| **qol W4** | Fixed (A) | ✅ Confirmed closed *(stated defect)* | The literal-`'template'` universal collision is gone — `fallbackLabel` (`templates.ts:76-80`) derives `cmd · dir`, distinct for differing content. A *narrower* residual collision remains (distinct cwds sharing basename + command word) — captured as new **N1**, a strictly smaller edge than the original finding. |
| **qol N1** | Fixed (A) | ✅ Confirmed closed | `stripAnsi` (`transcript.ts:742-749`) strips CSI/OSC(BEL+ST)/two-byte escapes; tests cover SGR/cursor/OSC/plain-untouched. (DCS/APC edge → new **N2**, not reachable from SerializeAddon.) |
| **qol N2** | Fixed (label) | ✅ Confirmed closed | `TerminalScreen.jsx:126` IconButton label = "Download transcript (may contain secrets echoed to the terminal)" (tooltip + aria-label). Honest acceptance note. |
| **qol N3** | Fixed (A) | ✅ Confirmed closed | `core/searchReadout.ts` extracted + tested; `TerminalScreen.jsx:93` consumes it, no inline derivation. |
| **qol N4** | Fixed (A) | ✅ Confirmed closed | Both handlers (composer + find bar) guard `e.nativeEvent.isComposing` before Enter. |
| **qol N5** | Fixed (A) | ✅ Confirmed closed | `saveTemplates` returns persisted-boolean (`templates.ts:91-94`); `setJustSaved(saveTemplates(next))` — a quota/private-mode failure leaves the button un-confirmed. |
| **rdp W1** | Fixed (A) | ✅ Confirmed closed | Degenerate bounds (`Width<=0 \|\| Height<=0`) short-circuit to `UNKNOWN → return` (`rdp-launcher.ps1:161-164`) *before* the portrait/narrow test and only inside the geometry `else`. Zero-geometry can never reach the phone-launch path. |
| **rdp W2** | Fixed (A) | ✅ Confirmed closed | `Close-StaleAppWindow` called by all three desktop branches (console `:139`, `-DesktopClientNames` `:146`, geometry-desktop `:172`); UNKNOWN deliberately omits it; `-WhatIfDecision` logs "would close" without killing. Match requires exact `--app=$Url`. |
| **rdp N1** | Fixed (A) | ✅ Confirmed closed | `Write-Log` truncates in place past 256KB keeping newest 500 lines (`:78-80`); parenthesized `Get-Content` fully materializes before `Set-Content` (no truncation race); whole body in try/catch. |
| **rdp N3** | Fixed (A) | ✅ Confirmed closed | `-PhoneClientNames` Gate 3 (`:152`) precedes geometry, correctly bypassing it; installer forwards it (`install.ps1:54-56`); header notes CLIENTNAME unverified. |
| **rdp N5** | Fixed (deeper) | ✅ Confirmed closed | `Split-Names` applied to *both* name lists (`:64-65`), preserving inner spaces; installer quotes both comma-joined lists to match. Root cause (`-File A,B` binds as one element, never splits) correctly addressed. |
| **seams S1** | Fixed (A) | ✅ Confirmed closed | Both halves extracted (`core/attention.ts` + `core/searchReadout.ts`), tested. No new inline pure-derivation in the diff's changed hunks (the pre-existing `dotStatus` ternary is untouched, out of scope). |

### Parked / accepted (verdict D — noted, not failures)

Not addressed *by design* per the slice docs, and verified as such (each is a documented decision, not an oversight): attention N3 (no-client-input assumption recorded), notify N2 (dedup could suppress legit re-alerts), notify N3 (caps exist; discipline documented), qol N6 (cosmetic `@ds/Input`), qol N7 (backlogged to scoped-tokens), rdp N2 (refactor cost > payoff at two scripts), rdp N4 (deferred to first real phone test), rdp N6 (threat-model-bounded log injection), seams S2 (a practice), seams S3 (deferred to templates phase 2). None re-opened on review.

## New findings (surfaced by the verification)

### Warnings

**W1. notify W3's "drop the `?.`" fix does not make a missing `clearAttention` discoverable — the message-handler catch still swallows it** — `server/src/ws.js:77-92` · confidence 62 · Maintainer
The `?.` is gone and the call was moved after `handle.write` (a real improvement: a throw no longer costs the keystroke). But `sessions.clearAttention(id)` at `:88` remains inside `try { … } catch { /* malformed message — ignore */ }`. If `clearAttention` is ever renamed, or a future non-`BoardSessions` implementation omits it, the resulting `TypeError` is caught and silently discarded — no `console.error`, nothing to grep for, and the needs-input flag silently never clears on web input. This is precisely the "regression with no error to grep for" the original W3 named; dropping the `?.` converts a silent no-op into an equally-silent caught exception because the enclosing catch was never accounted for. The `ws.test.js` fixture now carries its own no-op `clearAttention`, so a production rename wouldn't even fail the test. Dynamic JS means no typecheck catches it. Latent (gated on a future refactor), not a live bug.
**Fix:** wrap `clearAttention(id)` in its own `try/catch` with an explicit `console.error` (mirror the `[ws] session lookup failed` pattern already in this file at `:43`), or move it outside the JSON-parse guard so a missing-method failure is distinguishable from a malformed frame.

### Notes

**N1. `fallbackLabel` collides across different directories that share a basename + leading command word** — `client/src/core/templates.ts:76-80` · confidence 45 · Saboteur
`fallbackLabel('/work/api','claude')` and `fallbackLabel('/home/api','claude opus')` both yield `claude · api` (basename `api` + first token `claude`), so a second blank-name save silently upserts over the first — two genuinely different templates (different full cwd) collide. The qol W4 resolution note calls this "the sanctioned same-template re-save semantics," which is inaccurate for the distinct-cwd case. Blank-name-only and much narrower than the original W4 (which collided *all* blank saves on `'template'`), so NOTE, not a reopening.
**Fix:** disambiguate on collision with a non-matching cwd (append a parent-dir segment or short cwd hash); keep identical-cwd+command saves collapsing.

**N2. `stripAnsi` leaks DCS/APC/PM payloads and a truncated CSI intro as literal text** — `client/src/core/transcript.ts:742-749` · confidence 35 · Saboteur
A `DCS/APC/PM/SOS` sequence (`ESC P/_/^/X … ST`) has only its 2-char introducer + terminator stripped, leaving the payload as garbage; a truncated `\x1b[` at buffer end also survives (`[` sits between the two-byte rule's ranges). Not reachable from xterm `SerializeAddon` output today (it emits only complete SGR/CSI/OSC), so no real transcript is affected — a scope limit, not a live defect.
**Fix:** if DCS/APC ever appear, add a `/\x1b[P_^X][\s\S]*?(?:\x07|\x1b\\)/g` pass; otherwise document the stated CSI/OSC/two-byte scope so the residual is a known limit.

**N3. The UNKNOWN-branch invariant is documented ~50 lines from the branch it constrains** — `rdp-launcher.ps1:110-114` (comment) vs `:161-164` (branch) · confidence 35 · Maintainer
The "UNKNOWN deliberately does NOT call `Close-StaleAppWindow`" rule lives at the function definition, not at the UNKNOWN branch. A future edit to gate ordering has nothing at the branch site pointing back at the invariant, making it easy to silently violate (e.g. adding a teardown call to a false-read path that closes a real desktop's window).
**Fix:** add a one-line pointer comment at the UNKNOWN branch (`~:162`) referencing the docstring.

**N4. notify W5's origin pin depends on the relay origin never gaining an open-redirect** — `server/src/api.js:58-67` · confidence 30 · Security
W5 correctly reduces the deep-link surface to `AR_NOTIFY_URL_ORIGIN`. That fully closes the off-device redirect vector only while the relay origin exposes no attacker-steerable server-side redirect (today it serves only `/api`, pairing, and the static SPA — none redirect onward). A future `return_to`/OAuth-callback endpoint on this origin would let an XSS-driven notify caller chain relay-origin → attacker site, re-opening exactly the vector W5 closed.
**Fix:** note the no-open-redirect dependency in the `validateNotifyUrl` comment, or pin an allowed path prefix (deep-link only into the SPA root) rather than the whole origin; add a regression guard if such an endpoint is ever added.

### Summary

The remediation holds up under a hostile re-review: all five security/egress fixes (notify W4/W5, static N1) survived direct attack, every extraction/dedup fix is genuinely single-sourced, and the two systemic PowerShell fixes (rdp W1 fail-safe, N5 comma-split root cause) are correctly implemented. The one blemish is **notify W3**: the fix followed the letter of a suggested remedy but the enclosing message-handler catch — never accounted for by the original reviewer or the remediator — still swallows the failure the finding existed to expose. It is a one-line fix (W1) and gated on a future rename, so the practical risk is low; the verdict is **RESIDUE** solely on that unclosed row. New findings N1–N4 are all NOTE-level and either narrower than their originals or not currently reachable.

## Priority ranking (new findings only)

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| W1 | WARNING | 62 | notify W3 residual: missing `clearAttention` still swallowed by the msg-handler catch | fixed (2b597c0) |
| N1 | NOTE | 45 | `fallbackLabel` collides across distinct cwds sharing basename + command word | fixed (99838b9) |
| N2 | NOTE | 35 | `stripAnsi` leaks DCS/APC payloads (not reachable from SerializeAddon today) | fixed — scope documented (342db40) |
| N3 | NOTE | 35 | UNKNOWN-branch invariant comment placed far from the branch | fixed (342db40) |
| N4 | NOTE | 30 | notify W5 origin pin depends on no relay-origin open-redirect (forward-looking) | fixed — dependency documented (342db40) |

---

**Post-verify remediation (2026-07-07, same branch):** W1 fixed with its own guarded log (`try/catch` + `[ws] clearAttention failed` console.error, after the write) and an end-to-end WS test driving a real input frame against a store missing the method — mutation-proven. N1 fixed via `uniqueFallbackLabel` (widens with path segments only on a different-cwd clash; same-cwd re-save still collapses). N2/N3/N4 resolved as in-place scope/invariant/dependency comments per each finding's own framing. Full sweep green after: 217 server + 101 client tests, typecheck, launcher dry-run.

---

*A RESIDUE doc is itself a findings doc in the standard shape. Its one Not-closed row (notify W3 → new W1) plus N1–N4 can feed another `remediate` pass off the worktree head, or W1 can be a single follow-up commit and N1–N4 accepted — a user decision. Verify mode reports and stops.*
