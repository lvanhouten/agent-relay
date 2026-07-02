# Typing into a raw PTY through a phone soft keyboard is the worst part of the mobile UX

**Source:** Feature-gap brainstorm, 2026-07-02 — 90% of remote interactions are one-liners (`y`, `1`, `2`, a short reply, Ctrl+C), and xterm.js on a phone makes each of them painful.
**Status:** 💡 Proposed — 2026-07-02.
**Kind:** Enhancement
**Modules:** client/TerminalScreen
**Severity:** Medium — pure client work, no server or board changes.

## Motivation

`TerminalScreen.jsx` renders a faithful xterm.js terminal — right for a desktop, hostile on a phone: focusing the canvas summons the soft keyboard over half the viewport, autocorrect mangles input, and there are no modifier keys, so Ctrl+C / Esc are simply unreachable. The existing Ctrl+D-to-detach binding illustrates the gap — it assumes a physical keyboard.

## Proposal outline

- A slim composer bar docked above the soft keyboard: a plain `<input>` + Send button. Send writes the text plus `\r` through the existing WS `input` frame path (`useSessionWS` already exposes the send side) — no new protocol. A native input beats the xterm canvas for IME/autocorrect behavior. (medium)
- A row of canned chips above it: `Enter`, `y`, `1`, `2`, `Esc`, `Ctrl+C`, `Tab`, arrow keys — each a single tap sending the right byte sequence (`\x1b`, `\x03`, `\x1b[A`…). Chips are one-tap answers to the prompts agents actually ask. (small)
- Show the composer by default on coarse-pointer/small viewports, toggleable on desktop (occasionally nice there too — e.g. pasting a long prompt). (small)
- Keep the raw terminal fully interactive underneath; the composer is additive, not a mode switch.

## Risks / open questions

- Local-echo expectations: text typed in the composer appears in the terminal only when the shell echoes it back. For a Claude Code prompt that's fine (it echoes); for a password prompt it's correct behavior. No client-side echo.
- Bracketed paste: multi-line composer sends should reuse the semantics already built for `switchboard_send_input`'s opt-in `paste` mode (`2026-07-01-send-input-bracketed-paste.md`) rather than reinventing per-line submits — but note that logic lives board-side in the MCP server; the client would frame its own `\x1b[200~…\x1b[201~` wrapper. Keep the two write-ups consistent.
- No component-test harness exists for the client (per CLAUDE.md); the chip → byte-sequence mapping should live in a pure module (like `wsFrame.js`) so it's unit-testable.

## Trigger signals to prioritize

- First sustained phone usage — this and attention states are the two features that make the PWA real rather than technically-installable.
- Push notifications landing (`2026-07-02-hook-driven-push-notifications.md`): a notification tap drops you into the terminal, and this is what makes the next five seconds pleasant.
