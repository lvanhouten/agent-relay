# Adversarial Review: desktop-shell-v1 (desktop shell — master–detail workspace)

**Scope:** Client-only React feature adding a desktop shell (master–detail workspace) beside the existing mobile shell — boot-time shell selection, Alt+N session jump, desktop browser notifications, and a shared `FindBar` + `NewSessionDialog` extraction. ~2,100 lines across ~25 code files under `client/src/`. No server changes.
**Reviewed:** `44f6ab1..475807b` (branch `features/desktop-shell-v1` vs `main`; working tree clean)
**Verdict:** CONCERNS

### Summary

No criticals — the feature is well-factored (pure logic extracted into tested `core/*.ts` modules) and delivers all 23 live validation-contract assertions. The risk profile is a cluster of edge-case reliability bugs and one maintainability drift. **W1 (tombstone-decode triplication)** is the highest-confidence finding and the one most likely to bite a future maintainer; **W2 (unguarded Alt+N listener)** is the most user-visible defect — it eats `Alt+digit` keystrokes and silently swaps the selection while the operator is typing in a filter or dialog field. None block merge, but the four warnings should be resolved or consciously accepted.

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| ~~W1~~ | WARNING | 75 | Tombstone status decode hand-rolled in 3 places, wording already drifting | ✅ Resolved in `c10f391` |
| ~~W2~~ | WARNING | 62 | Alt+1..9 document listener has no focus/target guard — hijacks keys in text fields | ✅ Resolved in `aa14cb0` |
| ~~W3~~ | WARNING | 58 | Notification toggle branches on stale `enabled` — first re-enable click silently no-ops | ✅ Resolved in `4c8cd8c` |
| ~~W4~~ | WARNING | 55 | `resolveSelection` ref-fallback is subtle, inline, and untested — against the diff's own precedent | ✅ Resolved in `c0cc862` (bundled w/ N2) |
| ~~N1~~ | NOTE | 65 | Comments cite pruned `brief 0N` artifacts; one is stale on arrival | ✅ Resolved in `d8ae85e` |
| ~~N2~~ | NOTE | 45 | Selected tombstone becomes a frozen ghost if the board's 20-cap ring evicts it | ✅ Resolved in `c0cc862` (bundled w/ W4) |
| ~~N3~~ | NOTE | 35 | Unbounded/unsanitized session name flows into the OS Notification title/body | ✅ Resolved in `5c1ded0` |
| ~~N4~~ | NOTE | 32 | Alt+N listener re-subscribes every render (unmemoized `liveSessions`) | ✅ Resolved in `70a484a` |

**What's left:** Resolved 8 / Deferred 0 / Rejected 0 / Open 0. All warnings and notes closed as verdict A (accept as framed) across 7 atomic commits (`c10f391..70a484a`); W4+N2 bundled into one. No findings parked, no rejects — the E-count-smell gate never tripped.

### Warnings

**W1. Tombstone status decode hand-rolled in three places, already drifting** — `client/src/desktop/DetailPane.jsx:52-55` · confidence 75

**Status:** ✅ Resolved in `c10f391`.
**Resolution:** Verdict A (accept as framed). Extracted a pure `tombstoneView(session)` into `client/src/core/tombstoneView.ts` (beside `attention.ts`) returning `{ killed, failed, dot, label }`, and render DetailPane, Sidebar `TombstoneRow`, and SessionsScreen `ExitedSessionCard` from it — so the crash predicate and status word can't diverge and a future board `reason` value changes one place. The drifted DetailPane dot label now uses the shared terse word (`killed` / `exit N`); its banner keeps the fuller sentence, built from `tomb.killed`. Closure check: `tombstoneView.test.ts` (killed / clean-exit / non-zero-crash / null-code / kill-with-nonzero-code) — mutation-verified: flipping the `failed` predicate reddened the crash cases.

---

The same three-field derivation — `killed = reason === 'killed'`, `failed = !killed && exitCode != null && exitCode !== 0`, and a killed/exit-code label — is written independently in three spots:

- `DetailPane.jsx:52-55` → label `terminated` / `exited · code N`
- `Sidebar.jsx:44-48` (`TombstoneRow`) → label `killed` / `exit N`
- `SessionsScreen.jsx:84-89` (`ExitedSessionCard`) → label `killed` / `exit N`

Before this diff there was one copy (SessionsScreen); the diff added two more. The wording has **already drifted** — DetailPane renders "terminated" and "exited · code N" for states that Sidebar/SessionsScreen render as "killed" and "exit N" — so the same fact is worded three ways for the same session. The codebase already establishes the fix pattern: `core/attention.ts` exists precisely so "the one place the client decodes the status vocabulary" isn't duplicated per-screen (its docstring spells out why: a new server value must fail consistently at one sync point). The tombstone decode has no analogous module. A future `reason` value from the board requires finding and editing all three call sites with nothing enforcing it.

*Fix:* Extract a pure `tombstoneView(session): { dot, label, failed }` into `client/src/core/` alongside `attention.ts`, with unit tests mirroring `attention.test.ts`; render DetailPane, Sidebar, and SessionsScreen from it so wording and the crash predicate can't diverge again.

**W2. Alt+1..9 document listener has no focus/target guard** — `client/src/desktop/DesktopWorkspace.jsx:60-71` · confidence 62

**Status:** ✅ Resolved in `aa14cb0`.
**Resolution:** Verdict A. Added a pure `isTypingTarget(activeElement)` to `jumpKeys.ts` and bail on it in `DesktopWorkspace`'s `onKey` before `preventDefault`/`setSelectedId`. It suppresses the chord for `INPUT`/`TEXTAREA`/`contentEditable` targets (the sidebar filter, `NewSessionDialog` fields, the `FindBar`) but excludes xterm's own textarea (matched via `.closest('.xterm')`) so the chord still fires while the terminal is focused — VC-10/VC-11 preserved. Closure check: `jumpKeys.test.ts` — INPUT/TEXTAREA/contentEditable suppress, xterm textarea does not, non-editable/null do not; mutation-verified: dropping the `.xterm` exclusion reddened the xterm-textarea case.

---

*(Distinct-lens convergence: flagged independently by the Saboteur — "worst input" — and the Maintainer — "unstated cross-component coupling.")*

The workspace registers a `document`-level `keydown` listener that fires on **every** keydown and calls `e.preventDefault()` + `setSelectedId(...)` whenever `jumpIndexFromKey(e)` matches (Alt + a bare `Digit1`–`Digit9`), with no check on `e.target` / `document.activeElement`. `TerminalView`'s passthrough is correctly scoped to xterm, but this listener is global. So an `Alt+digit` pressed while focus is in:

- the sidebar **Filter sessions** input, or
- any `NewSessionDialog` field (name / cwd / command), or
- the `FindBar` query input

silently swaps the selected session behind whatever's on top and **eats the keystroke** (none of those inputs `stopPropagation` non-Enter/Escape keys). Before this diff a bare `Alt+digit` in a text field was a harmless no-op. VC-10/VC-11 only require the chord to work *while the terminal is focused* — this over-delivers into form fields where it's a surprise. The most reachable trigger is the always-present filter input.

*Fix:* In the `onKey` closure, bail when `document.activeElement` is an editable element that isn't xterm's own textarea (tag `INPUT`/`TEXTAREA` or `isContentEditable`), or gate the listener while `dialog` is open.

**W3. Notification toggle branches on the stale `enabled` flag, not the permission-resolved state** — `client/src/core/useDesktopNotifications.ts:48-63` · confidence 58

**Status:** ✅ Resolved in `4c8cd8c`.
**Resolution:** Verdict A. Added a pure `toggleAction(enabled, permission)` to `notifyGate.ts` returning `'disable'` only when notifications are actually live (`enabled && permission === 'granted'`) and `'request'` otherwise; `toggle()` now branches on it and `permission` was added to the callback deps. A stale `enabled=true` with a lapsed permission (browser auto-revocation, or a manual reset to `default`) now falls through to `requestPermission()` instead of silently no-opping on the first click. Closure check: `notifyGate.test.ts` — the `(enabled, default/denied) → 'request'` cases; mutation-verified: reverting the branch to raw `enabled` reddened exactly the stale-enabled cases, reproducing the bug.

---

`toggle()` decides its branch purely from the raw `enabled` boolean (seeded once from `localStorage` at mount): `if (enabled) { setEnabled(false); …; return; }`, else request permission. But the *rendered* state is `toggleView(supported, enabled, permission)`, which also depends on `permission`. `enabled` is only ever persisted as `'1'` when permission was `granted` (line 61), so the divergent state arises when permission changes **after** a successful enable — browser auto-revocation of unused notification permissions (Chrome/Edge do this without clearing `localStorage`), or the operator manually resetting the site permission to "default". On the next load, `enabled` is `true` but `permission` is `'default'`, so `toggleView` returns `'off'` and Sidebar renders a live (non-disabled) "Enable notifications" bell. The operator clicks it expecting the permission prompt — but `toggle()` sees `enabled === true`, takes the disable branch, and **never calls `requestPermission()`**. Only a second click actually re-requests. Net effect: a silent no-op on the first re-enable click in an increasingly common state.

*Fix:* Branch on the resolved state — `if (enabled && permission === 'granted') { …disable… return; }` (or reuse `canNotify(supported, enabled, permission)`) — so a stale-but-not-granted `enabled=true` falls through to `requestPermission()`.

**W4. `resolveSelection` ref-fallback is subtle, inline, and untested — against the diff's own precedent** — `client/src/desktop/DesktopWorkspace.jsx:41-44` · confidence 55

**Status:** ✅ Resolved in `c0cc862` (bundled with N2).
**Resolution:** Verdict A. Extracted the selection-resolution logic into a pure `resolveSelection(sessions, selectedId, lastKnown)` in `client/src/core/resolveSelection.ts`: live match → cached last-known while a *live* selection is transiently absent (fresh create / kill-suppression gap) → null. The `useRef` now only holds the cached value; `DesktopWorkspace` calls the pure function. Closure check: `resolveSelection.test.ts` (live present / just-exited tombstone still in poll / transient live fallback / stale-id-mismatch ignored / no-cache) — mutation-verified (see N2). Bundled with N2 because the review paired them: a single extraction closes both.

---

The `selectedRef` transient-absence fallback ("keep the last resolved selection so a just-created session not yet in the poll, or the one-cycle kill-suppression gap, doesn't flash the pane to empty") is genuinely subtle — it needs three sentences of comment — yet lives inline in a `.jsx` component with zero tests. Every *other* piece of non-trivial pure logic this same diff introduces (`jumpKeys`, `recency`, `notifyRules`, `notifyGate`, `shellSelection`, `keyPassthrough`) was extracted into `core/*.ts` specifically so `node --test` can pin it — CLAUDE.md's stated policy is that untested *pure logic* is a finding. The core here — given `(sessions, selectedId, lastResolved)`, what is the resolved selection — is a pure function of three inputs (the `useRef` is only the storage cell); nothing requires it to stay un-extracted. Its interaction with the auto-select and dismiss effects (lines 46-55, 92-97) ships with no regression guard, unlike every keyboard/selection rule alongside it. N2 is a concrete bug this untested logic already hides.

*Fix:* Extract `resolveSelection(sessions, selectedId, lastKnown): Session | null` into `client/src/core/`, unit-test the transient-absence and no-match cases the comment describes, and call it from `DesktopWorkspace` with the ref only holding the cached value.

### Notes

**N1. Comments cite pruned `brief 0N` planning artifacts; one is stale on arrival** — `client/src/desktop/DesktopWorkspace.jsx:14` · confidence 65

**Status:** ✅ Resolved in `d8ae85e`.
**Resolution:** Verdict A. Deleted the six `brief 0N` parentheticals across `DesktopWorkspace.jsx` (×2), `DetailPane.jsx`, `jumpKeys.ts`, `notifyRules.ts`, and `useDesktopNotifications.ts` — the standalone rationale survives in each — and reworded the stale `DesktopWorkspace.jsx` header comment to describe the notification wiring as present (it lives in this same component, not "a later slice"). Closure check: `rg 'brief 0[0-9]' client/src` returns nothing; comment-only, so typecheck + the full 174-test suite staying green confirms no behavior change.

---

Six new comments reference "brief 02/03/05/06" as the rationale for a decision. `rg 'brief 0[0-9]' client/src` → 6 occurrences across 4 files (`DesktopWorkspace.jsx:14,57`, `DetailPane.jsx:15`, `jumpKeys.ts:4`, `notifyRules.ts:3`, `useDesktopNotifications.ts:9`). These cite `_docs/work/` artifacts pruned after the PR merges — the code's next reader can never resolve them. In each case the surrounding prose already carries the standalone rationale (e.g. "…so they can never disagree about what counts as a jump chord"), so the parenthetical is pure noise. `DesktopWorkspace.jsx:14` is additionally stale on arrival: "a later slice (brief 06's notifications)" describes notifications as a future addition, but they're already wired into this same component.

*Fix:* Delete the `brief 0N` parentheticals (a mechanical sweep — the rationale survives); reword `DesktopWorkspace.jsx:14` to describe the notification wiring as present.

**N2. Selected tombstone becomes a frozen ghost if the board's 20-cap ring evicts it** — `client/src/desktop/DesktopWorkspace.jsx:41-44` · confidence 45

**Status:** ✅ Resolved in `c0cc862` (bundled with W4).
**Resolution:** Verdict A. `resolveSelection` (extracted for W4) returns `null` for an absent *tombstone* cache — a session evicted from the board's 20-cap ring — while transient *live* absences still fall back to the cache; a new orphan-clear effect in `DesktopWorkspace` releases `selectedId`/`selectedRef` on that null so the auto-select effect re-picks a live row instead of stranding the pane on a frozen ghost. The `status !== 'exited'` guard is what distinguishes an evicted tombstone (permanent) from a just-created/kill-suppressed live session (transient). Closure check: `resolveSelection.test.ts`'s `an evicted TOMBSTONE selection resolves to null, not the stale cache` — mutation-verified: dropping the `status !== 'exited'` guard reddened exactly that case, reproducing the frozen-ghost bug.

---

The board keeps only the last 20 ended lines (`server/board/board.js` ring, per CLAUDE.md). If the currently-selected session is a tombstone and 20 more sessions end while it stays selected and undismissed, the next poll's `sessions` no longer contains it — a *silent* eviction, not a local `kill()`/dismiss. `DesktopWorkspace`'s fallback (`else if (selectedRef.current && selectedRef.current.id === selectedId) selected = selectedRef.current;`) then renders the stale cached object indefinitely: the auto-select effect never re-fires (`selectedId` is still non-null), and the tombstone's dismiss control has already vanished from the sidebar (`endedSessions` is derived from the same evicted list). The only escape is manually clicking a live row. Rare in a single-operator relay, but a genuine stuck state. (Fixing W4 by extracting + testing `resolveSelection` is the natural place to also handle "selected id vanished without a local kill → clear it.")

*Fix:* When the previously-selected id disappears from `sessions` and isn't in the local kill-suppression set, clear `selectedId`/`selectedRef` so the auto-select effect can pick a live session.

**N3. Unbounded, unsanitized session name flows into the OS Notification title/body** — `client/src/core/notifyRules.ts:46-48` · confidence 35

**Status:** ✅ Resolved in `5c1ded0`.
**Resolution:** Verdict A. Added a pure `notifyName()` to `notifyRules.ts` that strips C0/C1 controls, zero-width and bidi-override characters (regex built from code points, so the source stays ASCII — a literal RLO in source would itself be unreviewable) and caps at 60 chars + ellipsis, and routed both the title and body through it. Rendering-only defense under the single-operator trust model, but cheap and mirrors `transcript.ts`'s allowlist discipline. Closure check: `notifyRules.test.ts` — strips ZWSP/RLO/LRI, strips BEL/ESC, caps overlong names, sanitizes the spec title+body; mutation-verified: a passthrough `notifyName` reddened all five, confirming the control-char test isn't a dud.

---

`notifyTransitions` builds `title: `${session.name} needs input`` and `body: `${session.name} is waiting on you.`` directly from the DTO `name`, with no length cap and no stripping of control/bidi characters (U+202E RTL override, zero-width). `name` is set at create time by any token holder (in the pairing model that can include a paired device, not only the operator at the keyboard). The OS banner is the least-context surface (no cwd/shell/branding), so a garbled or spoofed name reads with the least chance of being caught. Low severity under the single-operator trust model — it affects rendering only, crosses no code-execution boundary — but worth a cheap guard.

*Fix:* Cap the interpolated `name` (e.g. 60 chars + ellipsis) and strip bidi/zero-width characters before building the spec, mirroring the allowlist discipline already in `core/transcript.ts` (`transcriptFilename`).

**N4. Alt+N listener re-subscribes on every render** — `client/src/desktop/DesktopWorkspace.jsx:60-71` · confidence 32

**Status:** ✅ Resolved in `70a484a`.
**Resolution:** Verdict A. Memoized `liveSessions`/`endedSessions` on `[sessions, q]` in `DesktopWorkspace` so they keep a stable identity across renders that don't change the visible set; the Alt+N effect's `[liveSessions]` dependency now rebinds the document listener only when the visible ordering actually changes. Closure check: render-hygiene fix with no pure-logic surface — proven by the named memoized dependency (per CLAUDE.md's no-DOM-harness rule) plus the green 174-test + typecheck gate.

---

`liveSessions` is derived inline (`sessions.filter(...)`) each render, so it's a fresh array reference even when contents are unchanged (typing in the filter, toggling the dialog, changing `selectedId`). The Alt+N effect depends on `[liveSessions]` by reference, so React tears down and re-adds the `document` keydown listener on every such render. Harmless today (single-threaded; no keydown can slip between remove/add), but churn a future edit (async work in the effect, a side-effecting cleanup) could turn into a real bug.

*Fix:* `useMemo` `liveSessions` on `[sessions, query]`, or depend the effect on a stable id-array so it rebinds only when the visible ordering actually changes.

---

**Promised-vs-delivered sweep (VC-1..VC-23):** all 23 live assertions are delivered by the diff; none are struck/superseded and none are unmet. VC-10/VC-11's Alt+N contract is delivered but *over*-delivered (W2). No absence findings.

**Not raised (checked, sanctioned by the constraints brief):** no resize listener (VC-6 / glossary — intentional); `sessionStorage` for shell override vs `localStorage` for notify opt-in (both documented, per-window vs origin-global); geometry-only phone detection (glossary); `recency.ts` parsing a formatted `lastActive` string (documented DTO constraint); the sidebar live-order parity gap vs mobile (already logged in STATUS.md for adjudication — the desktop preserving poll order is defensible and within brief 05's written criteria).
