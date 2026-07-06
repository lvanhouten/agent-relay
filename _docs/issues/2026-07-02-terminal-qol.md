# Terminal quality-of-life: no search, no transcript download, no scroll-to-bottom affordance

**Source:** Feature-gap brainstorm, 2026-07-02 — grab-bag of small client-only gaps that show up the first time a session produces real volume.
**Status:** 💡 Proposed — 2026-07-02. **Revisited 2026-07-06:** the scroll-to-bottom pill specifically is promoted by the RD-app phone path (`2026-07-06-rdp-mobile-session-recipe.md`) — touch-scrolling xterm scrollback through RDP is the worst version of the no-affordance problem; an in-page tap target fixes it for RDP and native mobile alike.
**Kind:** Enhancement
**Modules:** client/TerminalScreen
**Severity:** Low — independent small items, good gap-fillers between larger features.

## Motivation

The terminal screen is a faithful viewport and nothing more. With 2000 chunks of agent output behind it, three absences bite: you can't search scrollback ("did it touch that file?"), you can't save what you're looking at, and when you scroll up to read, new output keeps arriving below with no indication or quick way back.

## Proposal outline

Three independent items, any order:

- **Search** — `@xterm/addon-search` (fits the existing fit-addon pattern in `TerminalScreen.jsx`) plus a minimal find bar (input, next/prev, match count) using the design-system `Input`/`IconButton`. Wire Ctrl+F when the terminal has focus — note the existing keyboard-shortcut handling (Esc/Ctrl+D) as the precedent for intercepting keys before xterm swallows them. (small–medium)
- **Download transcript** — `@xterm/addon-serialize` (preserves what the buffer holds) dumped to a `Blob` download named `<session-name>-<timestamp>.txt`. Honest cap: this exports the *client's* buffer — the replayed scrollback since attach, max 2000 chunks — not the session's full history; full history is `2026-07-02-scrollback-persistence.md`. (small)
- **Scroll-to-bottom pill** — track `term.buffer.active.viewportY` vs. bottom on scroll; when detached from the tail, float a "↓ N new lines" pill that jumps back down. Standard terminal-emulator furniture, absent here. (small)

## Risks / open questions

- No client component-test harness exists (per CLAUDE.md) — keep any non-trivial logic (scroll-position math, filename formatting) in pure modules beside `wsFrame.js` so the named-guarded-path convention holds.
- Downloaded transcripts can contain secrets echoed in output; the file lands in the browser's downloads directory outside the relay's control. Not a blocker (the operator already sees the bytes), but the same caveat `2026-07-02-scrollback-persistence.md` carries.

## Trigger signals to prioritize

- First long-running session someone actually reads back through (search + pill).
- First "attach the output to an issue/review" moment (download).
