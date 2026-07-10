## Validation-Contract Coverage: desktop-shell-v1 — 44f6ab1..e2d5f8e

**Contract:** _docs/work/desktop-shell-v1/validation-contract.md
**Range:** 44f6ab1..e2d5f8e637e2d47741bb056e097a9b18b6453503 (feature base → integrated head)
**Verdict:** DELIVERED

| VC-n | Status | Evidence / gap |
|------|--------|----------------|
| VC-1 | ✅ delivered | `decideShell` (`core/shellSelection.ts:30`) returns `desktop` for width≥768 ∧ width≥height; `App.jsx:114` renders `DesktopWorkspace` = `Sidebar` + `DetailPane` side by side, no screen-swap |
| VC-2 | ✅ delivered | `isPhoneShaped` (`shellSelection.ts:26`) `height>width \|\| width<768` → `mobile`; `App.jsx:121,130` routes to the unchanged `SessionsScreen`/`TerminalScreen` stack (only additive `onToggleShell` prop) |
| VC-3 | ✅ delivered | desktop: `Sidebar.jsx:138` "Switch to mobile layout" (Smartphone); mobile: `SessionsScreen.jsx:319` "Switch to desktop layout" (Monitor); both call `toggleShell` (`App.jsx:36`) which flips `shell` state immediately |
| VC-4 | ✅ delivered | `toggleShell` writes `writeShellOverride(sessionStorage, next)`; boot `decideShell` reads `readShellOverride(sessionStorage)` first (`shellSelection.ts:31`) — reload = same window, sessionStorage persists |
| VC-5 | ✅ delivered | override stored in `window.sessionStorage` (per-window), never `localStorage` — a fresh window/tab has no override and falls to the heuristic (`shellSelection.ts:7-11` rationale) |
| VC-6 | ✅ delivered | shell measured once in `App.jsx:29` `useState` lazy initializer; no resize listener anywhere, so crossing the boundary post-load never re-decides |
| VC-7 | ✅ delivered | `Sidebar` `SessionRow` → `attentionFor(session.status)` (`core/attention.ts:40`) maps running/idle/needs-input to dot+pulse; fed by `useSessions` 5s poll (`DesktopWorkspace.jsx:19`), no reload |
| VC-8 | ✅ delivered | `Sidebar.jsx:121-135`: "Recently exited (N)" header with count, collapsed rows expand on `showEnded` toggle; `handleDismiss` → `kill`→board `forget` (`DesktopWorkspace.jsx:119`) — same path/gating (`ended.length>0`) as phone `SessionsScreen.jsx:384` |
| VC-9 | ✅ delivered | `Sidebar` `onSelect`→`setSelectedId`; `DetailPane` renders `<TerminalView key={session.id}>` (`DetailPane.jsx:141`) — remount attaches WS to that line, scrollback replays on connect |
| VC-10 | ✅ delivered | document `keydown` listener (`DesktopWorkspace.jsx:82-96`) → `jumpIndexFromKey` (Alt+Digit1-9), selects `liveSessions[idx-1]`; TerminalView `passthroughKeys={isJumpChord}` (`DetailPane.jsx:149`) leaves the chord un-consumed via `shouldXtermConsumeKey` so it fires with terminal focused |
| VC-11 | ✅ delivered | `liveSessions` filtered by `query` and memoized (`DesktopWorkspace.jsx:38-44`); both `Sidebar` render and Alt+N read the same array, so the chord follows filtered order |
| VC-12 | ✅ delivered | shared `NewSessionDialog` from `chrome/NewSessionDialog.jsx` (`DesktopWorkspace.jsx:151`); `handleCreate` sets `selectedRef`+`selectedId` to the new session (`:104-106`) so it appears and becomes selected |
| VC-13 | ✅ delivered | `handleKill`→`kill(id)` (`DesktopWorkspace.jsx:115`); the session becomes an `exited` tombstone and partitions into `endedSessions` → the Recently-exited group |
| VC-14 | ✅ delivered | auto-select effect guarded on `selectedId!==null` (`DesktopWorkspace.jsx:63`) never switches away when the selected session exits; `resolveSelection` returns the tombstone; `DetailPane.jsx:132` shows the read-only exit banner over the retained terminal |
| VC-15 | ✅ delivered | `DetailPane` toolbar: `FindBar` with `searchResults` readout (`:122`), `downloadTranscript` (`:79`), copy-selection (`:111`); backed by TerminalView handle `searchNext`/`searchPrev`/`clearSearch`/`serialize`/`getSelection` (`TerminalView.tsx:56,64,66-69`) |
| VC-16 | ✅ delivered | `notifyTransitions` (`notifyRules.ts:39`) emits a spec on entry into needs-input when `!windowFocused`; hook fires `new Notification(spec.title …)` with `title = "<name> needs input"` (`useDesktopNotifications.ts:77-79`) |
| VC-17 | ✅ delivered | `notifyTransitions` returns `[]` when `windowFocused` (`notifyRules.ts:46`); hook passes `document.hasFocus()` (`useDesktopNotifications.ts:77`) |
| VC-18 | ✅ delivered | `n.onclick` → `window.focus()` + `onSelectRef.current(spec.sessionId)` (`useDesktopNotifications.ts:80-83`); `onSelect` wired to `setSelectedId` at the workspace root (`DesktopWorkspace.jsx:28`) |
| VC-19 | ✅ delivered | `NotificationSpec.tag = session.id` (`notifyRules.ts:63`) passed as `{ tag }` to the constructor (`useDesktopNotifications.ts:79`) — same tag replaces rather than stacks |
| VC-20 | ✅ delivered | `Notification.requestPermission()` called only inside `toggle` (`useDesktopNotifications.ts:59`); boot reads `Notification.permission` (`currentPermission`, `:23`) without requesting |
| VC-21 | ✅ delivered | zero sessions → `DetailPane` empty state with a "New session" button (`DetailPane.jsx:40-49`); ≥1 → auto-select `pickMostRecentLive` (`recency.ts:25`) via the effect at `DesktopWorkspace.jsx:63-67` |
| VC-22 | ✅ delivered | `Sidebar` footer theme `IconButton` (`Sidebar.jsx:151`) → `onToggleTheme` → `App.toggleTheme` (`App.jsx:90`) flips `data-theme` dark/light |
| VC-23 | ✅ delivered | `notifyTransitions` skips when `before.status === 'needs-input'` (`notifyRules.ts:59`) — an already-blocked session at focus-loss fires nothing; the pulsing `attention` dot (`attention.ts:33`) keeps signalling |

### Summary

DELIVERED — 23 live assertions, 23 delivered, 0 undelivered, 0 superseded. The contract carries no `SUPERSEDED` strikes (all three `briefs/STATUS.md` deviations record "no VC-n affected"), so strike reconciliation is vacuous. Every promised behavior of the desktop shell — the boot-time shell split with sticky per-window override, the master-detail workspace with attention states / Alt+N jump / filter / tombstones, the shared create dialog, the exit-in-place banner, and the transition-based desktop notifications with their focus and permission gates — is delivered by code in range. The one known parity nuance (desktop sidebar does not float needs-input sessions to the top the way mobile does, flagged in STATUS review-stage notes) is out of contract scope: VC-7 requires *showing* the attention state, not ordering by it, and VC-10/VC-11 define jump order as the Nth visible/filtered row — so it is not an undelivered assertion.
