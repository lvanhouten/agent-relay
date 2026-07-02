# Multi-line input sent to a line auto-submits each line instead of pasting a block

**Source:** Came up auditing the MCP `switchboard_send_input` tool. When the caller sends a `text` value with embedded newlines, every `\n`/`\r` is delivered to the shell as a separate Enter keystroke, so each line auto-submits independently rather than being pasted as one block.
**Status:** ⏸ Deferred — 2026-07-01.
**Kind:** Enhancement
**Modules:** board (mcp-server)
**Severity:** Low

## What's already been closed

Nothing — this is an unstarted enhancement whose correct behavior is a product decision, not a clear bug.

## What remains

`sendInput` in `server/board/mcp-server.js` writes `text + (submit ? '\r' : '')` straight to the line's data pipe. A multi-line `text` (a plausible LLM-agent input — e.g. a pasted heredoc or a multi-command block) has each embedded newline interpreted by the shell as a submit, so the lines run one at a time rather than arriving as a single pasted block. There is no bracketed-paste framing.

## Fix outline

- The core question is a behavior decision, not an implementation detail: should multi-line input *submit each line* (useful for running a command sequence) or *paste one block* (useful for editing before running)? Both are legitimate; today's behavior is the former, implicitly.
- If block-paste is wanted: optionally wrap the payload in bracketed-paste escapes (`\e[200~` … `\e[201~`) — but only when the receiving program has bracketed paste enabled, which the board can't know. (small code, but semantics need deciding)
- Consider an explicit tool parameter (e.g. `paste: true`) rather than changing the default, so existing callers relying on per-line submission aren't silently broken.
- Cross-cutting risk: bracketed paste that the target app doesn't understand leaves literal `\e[200~` noise in the buffer — worse than the current behavior.

## Trigger signals to reopen

- An agent caller reports multi-line input being mangled or partially executed.
- A concrete use case emerges for pasting a block (e.g. editing a multi-line command before submit).

## Repro

Call `switchboard_send_input` with `text: "echo one\necho two"` and observe both `echo one` and `echo two` run as separate commands, rather than the two-line text arriving as one editable paste.
