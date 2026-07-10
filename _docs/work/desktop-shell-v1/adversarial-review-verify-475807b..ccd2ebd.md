# Remediation Verification: desktop-shell-v1 — `475807b..ccd2ebd`

**Verifies:** `_docs/work/desktop-shell-v1/adversarial-review-44f6ab1..475807b.md`
**Range:** `475807b..ccd2ebdb` (8 remediation commits `c10f391..70a484a` + the annotation commit `ccd2ebd`; fixes live in the isolated worktree `.worktrees/r-475807b`, branch `remediate/desktop-shell-v1/475807b`)
**Verdict:** CLEARED

### Summary

The remediation can merge. All 8 original findings (4 warnings, 4 notes — no criticals) are Confirmed closed: each claimed verdict-A fix was independently re-derived from the fix code, not read off its Resolution, and each closure test genuinely exercises its defect (verified by reading the assertions, not trusting the mutation notes). The gate is green where it can run — 174/174 client tests pass and `tsc -p tsconfig.json` is clean once the isolated worktree has its declared devDependencies installed. The new-defect sweep of the fix code surfaced no criticals or warnings; one trivial low-confidence NOTE (N1) on a UTF-16 boundary in the new name-truncation, cosmetic-only and inside the same single-operator rendering-trust envelope the original N3 was accepted under.

## Priority ranking

*(new findings introduced by the remediation — one thin NOTE)*

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| N1 | NOTE | 25 | `notifyName` length cap can slice a UTF-16 surrogate pair, emitting a lone surrogate before the ellipsis | (open) |

### Close-out (original findings)

| Orig ID | Claimed | Verify verdict | Evidence |
|---------|---------|----------------|----------|
| W1 | Resolved (A) `c10f391` | ✅ Confirmed closed | `tombstoneView(session)` in `core/tombstoneView.ts` is the sole decode; grep for `=== 'killed'` / `exit ${` / `exitCode !== 0` across `client/src` returns only that module — DetailPane/Sidebar/SessionsScreen all render from it. Drift eliminated: DetailPane's dot label now uses the shared terse word (`killed`/`exit N`), not the old `terminated`/`exited · code N`; banner sentence rebuilt from `tomb.killed`. `tombstoneView.test.ts` asserts the whole `{killed,failed,dot,label}` object across killed / kill-with-137 / clean-0 / non-zero / null-code — non-vacuous. |
| W2 | Resolved (A) `aa14cb0` | ✅ Confirmed closed | `isTypingTarget(document.activeElement)` bails in `onKey` **before** `preventDefault`/`setSelectedId` (`DesktopWorkspace.jsx:88`). Suppresses `INPUT`/`TEXTAREA`/`contentEditable`; excludes xterm's textarea via `.closest('.xterm')` so VC-10/VC-11 survive. `jumpKeys.test.ts` covers all five arms incl. the xterm-textarea negative. |
| W3 | Resolved (A) `4c8cd8c` | ✅ Confirmed closed | `toggleAction(enabled, permission)` returns `'disable'` only when `enabled && permission === 'granted'`; `toggle()` branches on it and `permission` is now in the `useCallback` deps (`useDesktopNotifications.ts:53,66`) — `permission` is a real state cell (line 40), so the stale-`enabled` + lapsed-permission path now falls through to `requestPermission()` on the first click. `notifyGate.test.ts` pins `(true,'default')→'request'` and `(true,'denied')→'request'`. |
| W4 | Resolved (A) `c0cc862` | ✅ Confirmed closed | `resolveSelection(sessions, selectedId, lastKnown)` extracted to `core/resolveSelection.ts`, pure, 7 tests; the `useRef` now only stores the cached value and `DesktopWorkspace` calls the function. Transient-live-absence fallback preserved (fresh create / kill-suppression gap → cache when `status !== 'exited'`). |
| N1 (orig) | Resolved (A) `d8ae85e` | ✅ Confirmed closed | `rg 'brief 0[0-9]' client/src` → **no matches** (claim independently reproduced). The stale `DesktopWorkspace.jsx` header comment now describes the notification wiring as present, not "a later slice". Comment-only; 174 tests + typecheck green confirm no behavior change. |
| N2 (orig) | Resolved (A) `c0cc862` | ✅ Confirmed closed | The `status !== 'exited'` discriminator in `resolveSelection` returns `null` for an evicted tombstone (permanent ring eviction), and the new orphan-clear effect (`DesktopWorkspace.jsx:75-77`) releases `selectedId`/`selectedRef` on that null so auto-select re-picks a live row. Traced the effect cycle: `orphaned` flips true→false after the clear (selectedId→null), so no re-fire and no loop; DetailPane already renders an empty state for a null session (`DetailPane.jsx:40`). `resolveSelection.test.ts` pins the evicted-tombstone→null case distinctly from the transient-live fallback. |
| N3 (orig) | Resolved (A) `5c1ded0` | ✅ Confirmed closed | `notifyName()` strips C0/C1, zero-width, and bidi-override/isolate code points (regex built from `\u….` escapes so the source stays ASCII) and caps at 60; both title and body route through it (`notifyRules.ts:63-66`). `notifyRules.test.ts` strips ZWSP/RLO/LRI + BEL/ESC and checks an end-to-end spec — the sanitize isn't a dud. (See new N1 for the cap's surrogate edge.) |
| N4 (orig) | Resolved (A) `70a484a` | ✅ Confirmed closed | `liveSessions`/`endedSessions` memoized on `[sessions, q]` (`DesktopWorkspace.jsx:38-44`); the Alt+N effect's `[liveSessions]` dep now keeps a stable ref across renders that don't change the visible set (typing elsewhere, toggling the dialog, changing `selectedId`), so the document listener no longer rebinds on every render — the stated churn is gone. |

### New findings (introduced by the remediation)

**N1. `notifyName` length cap can split a UTF-16 surrogate pair** — `client/src/core/notifyRules.ts:34` · confidence 25

The cap `clean.length > max ? clean.slice(0, max - 1) + '…'` counts and slices by UTF-16 code units. A name whose 59th/60th code units are a surrogate pair (a name ending in an astral character — an emoji — right at the boundary) is sliced mid-pair, leaving a lone high surrogate before the ellipsis; the OS banner renders one `�`. Cosmetic only, self-inflicted (the operator's own session name), and squarely inside the single-operator rendering-trust envelope the original N3 was accepted under — not a security or correctness regression, hence a low-confidence NOTE rather than a blocker. If ever tidied: slice with `Array.from(clean).slice(0, max - 1).join('')` so the unit is a code point, not a code unit.

---

**Gate evidence.** `npm test --workspace=client` → 174/174 pass (all new closure tests included). `npm run typecheck --workspace=client` → clean (`tsc -p tsconfig.json`, no output) after `npm install` in the isolated worktree; the pre-install failures were entirely `Could not find a declaration file for module 'react'` cascades — an install-state artifact, proven by their hitting files this diff never touched (`useSessions.ts`, `useSessionWS.ts`) while every new react-free core module (`resolveSelection.ts`, `tombstoneView.ts`, and the `jumpKeys`/`notifyGate`/`notifyRules` additions) produced zero errors.

**Regression / wrongly-rejected sweep.** No verdict-E rejects existed to re-examine (all 8 were verdict A). New-code review of the fix diff — the two new `DesktopWorkspace` effects, the extracted pure modules, the widened `useCallback`/`useEffect` dep arrays — found no reachable defect beyond N1: the orphan-clear effect is loop-free, the memo's new-object return is harmless (the destructured arrays are what the effect compares), and the widened notify deps only re-identify a click handler that is already ref-indirected.
