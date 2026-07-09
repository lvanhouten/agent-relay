# Execution status — desktop-shell-v1

| Brief | Status | Wave | Merged SHA | Criteria | Note |
|---|---|---|---|---|---|
| 01-shell-selection-core | integrated | 1 | be6ddb9 | 4/4 | |
| 02-notify-rules-core | integrated | 1 | 064e911 | 9/9 | |
| 03-jump-keys-and-terminal-passthrough | integrated | 1 | f4040fe | 4/4 | |
| 04-find-bar-extraction | integrated | 1 | 1b3cf93 | 4/4 | browser proof of VC-2/VC-15 rides brief 05 / verify |
| 05-desktop-workspace | pending | 2 | — | — | exclusive; Depends on 01,03,04 (all integrated) |
| 06-desktop-notifications | pending | 3 | — | — | exclusive; Depends on 02,05 |

## Handoff notes
- **01-shell-selection-core → [05-desktop-workspace]:** module at `client/src/core/shellSelection.ts` exports `ShellKind`, `StorageLike`, `decideShell`, `readShellOverride`, `writeShellOverride`; storage key `'ar-shell-override'`, intended for `window.sessionStorage` (never `localStorage`) per per-window isolation. (contract-change)
- **02-notify-rules-core → [06-desktop-notifications]:** `notifyTransitions(prev, next, windowFocused)` and `NotificationSpec` (tag === sessionId) at `client/src/core/notifyRules.ts`, named exports. (contract-change)
- **03-jump-keys-and-terminal-passthrough → [05-desktop-workspace]:** `jumpIndexFromKey` exported from `client/src/core/jumpKeys.ts` (not TerminalView/types); import for the document listener, and pass `(e) => jumpIndexFromKey(e) !== null` as TerminalView's `passthroughKeys`. Passthrough glue extracted to `keyPassthrough.ts` (`shouldXtermConsumeKey`). (contract-change)
- **04-find-bar-extraction → [05-desktop-workspace]:** `FindBar` at `client/src/chrome/FindBar.jsx` (new shared-chrome dir), `export function FindBar({ results, onQuery, onNext, onPrev, onClose })`; inline-styled over tokens (no CSS Modules) so it drops straight into the desktop toolbar. (contract-change)

## Deviations
- **03-jump-keys-and-terminal-passthrough:** extracted the `attachCustomKeyEventHandler` glue into a separate `keyPassthrough.ts` module (rather than inline in `TerminalView.tsx`) so it is unit-testable — `.tsx` can't be imported by the `node --test` type-stripping runner. Additive only; 05's consumed interface (`jumpIndexFromKey` + `passthroughKeys` prop) unchanged. **Contract:** no VC-n affected.
- **04-find-bar-extraction:** the "mobile find flow verified in a real browser" criterion was verified by code inspection (mechanical 1:1 lift + named IME guard) rather than a live browser, per orchestrator instruction (Runtime parallel-safe → no app boot alongside other workers). Behavior unchanged; the VC-2/VC-15 browser proof rides brief 05's verification and the verify stage. **Contract:** no VC-n affected.
