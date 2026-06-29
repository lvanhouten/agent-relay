# Esc and Ctrl+D keyboard shortcuts shown in the UI are not functional

**Source:** Identified during scaffold review (2026-06-29) — original finding "Keyboard shortcuts".
**Status:** Deferred — 2026-06-29.
**Kind:** Bug
**Modules:** client/TerminalScreen
**Severity:** Low

## What's already been closed

Nothing — the shortcuts are UI hints only; no handler logic was ever written.

## What remains

`TerminalScreen.jsx` displays two keyboard hints that do nothing:
- "esc to cancel a run" (input bar hint, line ~197) — should send `\x03` (ETX / Ctrl+C) to the PTY
- `<Kbd keys={['Ctrl', 'D']} /> detach` (footer, line ~215) — should close the WS and navigate back to the sessions screen

Note: this issue is partially superseded by the xterm.js gap. Once xterm.js is integrated, `terminal.onData` will handle raw key sequences automatically — Ctrl+C and Ctrl+D will pass through without special handling. The Ctrl+D detach behavior (WS close + navigate back) will still need explicit logic.

Affected files:
- `client/src/screens/TerminalScreen.jsx` — `onKey` handler and `doSend`

## Fix outline

- **If xterm.js is NOT yet integrated:** add an `onKeyDown` handler to the text `<input>` that intercepts `Escape` (sends `\x03` via `send()`) and `Ctrl+D` (calls `ws.close()` then `onBack()`).
- **If xterm.js IS integrated:** `terminal.onData` already forwards Ctrl+C as `\x03`; only Ctrl+D needs special-casing — attach a `terminal.onKey` listener that checks for `\x04` and triggers WS close + `onBack()`.
- Remove or update the UI hints if the behavior changes (e.g. if "esc" becomes "Ctrl+C" with xterm.js).
- Estimated cost: **small** — a few lines in either path.

## Trigger signals to reopen

- User tries to cancel a running Claude Code tool call and can't.
- User gets stuck in a session with no way to exit without refreshing the page.

## Repro

1. Open a terminal session.
2. Start a long-running command (e.g. `sleep 60`).
3. Press Esc — nothing happens; the command is not interrupted.
4. Press Ctrl+D — nothing happens; session stays open.
