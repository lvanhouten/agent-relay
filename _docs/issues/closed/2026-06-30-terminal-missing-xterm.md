# TerminalScreen strips ANSI and renders plain text instead of a real terminal

**Source:** Identified during scaffold review (2026-06-29) — original finding "xterm.js".
**Status:** Closed — 2026-06-29.
**Kind:** Enhancement
**Modules:** client/TerminalScreen
**Severity:** High

## What's already been closed

WebSocket plumbing is complete — the server streams raw PTY output and the client receives it. The `resize` message type is defined on both ends.

## What remains

`TerminalScreen.jsx` passes all PTY output through `stripAnsi` and renders it as plain text `<div>` lines. This loses all color, cursor positioning, interactive prompts, and in-place updates (progress bars, vim, htop, etc.). The `resize` callback in `useSessionWS` is defined but never called because there is no xterm.js instance to read dimensions from.

Affected files:
- `client/src/screens/TerminalScreen.jsx` — entire output rendering path
- `client/src/utils/stripAnsi.js` — will be unused after the swap
- `client/package.json` — `xterm` and `@xterm/addon-fit` not yet added as dependencies

## Fix outline

- Add `xterm` and `@xterm/addon-fit` to `client/package.json`.
- Replace the `<div>` transcript and `lines` state in `TerminalScreen` with an xterm.js `Terminal` instance mounted into a `<div ref>` via `terminal.open(containerEl)`.
- Attach the `FitAddon`, call `fitAddon.fit()` on mount and on `ResizeObserver` firing on the container element; send the resulting `{ cols, rows }` via the existing `resize` WS message.
- Pipe incoming `msg.payload` directly to `terminal.write(payload)` — no ANSI stripping.
- On WS open, replay the scrollback buffer into `terminal.write()` the same way live data is written (the server already sends it as a single `data` message).
- Handle `msg.type === 'exit'` by writing a styled system line via `terminal.writeln()`.
- Wire keyboard input: use `terminal.onData((data) => send(data))` instead of the current text `<input>` bar. Remove the input bar and its `doSend`/`onKey` handlers.
- Apply the active theme to xterm's `theme` option (map CSS custom properties to xterm's color fields) so dark/light toggle keeps working.
- Estimated cost: **medium** — the WS and resize contracts are already in place; the work is replacing the rendering layer and cleaning up the old input path.

## Trigger signals to reopen

- Any session running an interactive program (vim, htop, Claude Code's own TUI, shell prompts with color).
- First mobile/tablet test — plain text is especially painful on small screens without real cursor positioning.
- Any user feedback that the terminal "looks broken."

## Repro

1. Start a session running `claude` or any program that emits color/cursor output.
2. Observe that the terminal view shows garbled or empty lines — ANSI escape sequences are stripped rather than interpreted.
3. Run `vim` or `htop` in a session — the display is completely unusable.
