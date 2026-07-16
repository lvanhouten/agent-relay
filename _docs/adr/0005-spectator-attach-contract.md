---
status: accepted
date: 2026-07-07
deciders: Lukas Van Houten (owner), Claude (advisor)
---

# 0005 — Spectator attach: declared at attach, dropped frames, poll-propagated dims

## Context

The board clamps a mirrored line's PTY to its *smallest* attached client
(`applyMin` in `board.js`), so any multi-pane view that naively attached small
terminals would shrink every session's real PTY and garble the layout for the
agent running in it. Nor is "just don't send resize" enough on its own: a
watching client's local xterm still has *some* column count, and if it differs
from the PTY's real dims, cursor-positioned TUI output (Claude Code's own UI)
garbles locally. Two upcoming features need a watch-only attach: the desktop
shell's pane grid (slice 2) and scoped tokens' `read` class.

Verified against the board (2026-07-06): clamp sizes are keyed per control
socket and cleaned on socket close — a client that never sends `resize` never
enters the clamp. And the board has **no resize-event concept anywhere**: the
data pipe is raw bytes, the control plane is request/response only.

## Decision

A **spectator** is a watch-only attach with these four properties:

1. **Board carries dims in `list`.** Each line's reply row gains its current
   PTY `cols`/`rows` — a pure additive read of state the board already owns
   (same additive pattern as the `ended` array).
2. **Spectator is declared at attach.** The web WS URL takes `?mode=spectator`;
   `src/ws.js` tags the connection at upgrade.
3. **Inbound `input`/`resize` frames are dropped, not errored.** Same posture
   scoped tokens chose for `read`; the frame filter in `ws.js` is one seam with
   two consumers (query-param mode now, token-derived scope later). Board-side,
   the spectator stays out of the clamp automatically — it never sends
   `resize`.
4. **Rendering adopts the PTY's dims.** A spectator `TerminalView` sets its
   local xterm to the reported `cols`/`rows` and CSS-scales the canvas to fit
   its pane — thumbnail-style. It never calls fit, never sends resize. Dim
   changes propagate via the existing 5 s sessions poll; no push channel.

## Considered and rejected

- **Server-pushed `dims` frame on the WS.** Instant thumbnail resize, but the
  board doesn't announce resizes, so every variant invents machinery: a new
  control-plane broadcast concept (protocol surface nothing else needs),
  in-band sentinels on the data pipe (corrupts the one pure byte plane), or the
  web tier echoing its own clients' resizes (misses `sb`-pane resizes —
  incomplete, not just lagged). A PTY resize is a rare, cosmetic event; a ≤5 s
  stale thumbnail is an acceptable cost and the poll already carries per-line
  data to the component tree that owns the panes.
- **Local fit + letting the clamp handle it.** Rejected outright — the clamp
  exists to protect interactive clients; a grid of small panes would resize
  every agent's real terminal to mini dimensions.
- **CSS-only scaling of a default-dims terminal.** Without adopting the real
  cols/rows, cursor-positioned output still garbles locally; scaling must start
  from the PTY's true grid.

## Consequences

- Slice 2 (`_docs/issues/2026-07-07-desktop-spectator-panes.md`) implements all
  four points; the desktop shell v1 layout can assume them without building any.
- Scoped tokens (`_docs/issues/2026-07-02-scoped-tokens.md`) reuses the `ws.js`
  frame filter with a token-derived scope instead of the query param. The query
  param is a *mode*, not a security boundary — a full-token client asking for
  spectator gets watch-only behavior, but only the token scope (later) makes
  watch-only *enforced against an untrusted holder*.
- The focused pane in a grid is interactive (owns sizing); the rest are
  spectators. Focus changes are a **live mode-switch, not a detach + reattach**:
  the pane keeps its data pipe open across focus changes and flips mode with a
  `{type:'mode',spectator}` WS frame, which toggles the server's input gate and
  opens/closes the board control socket (leaving/entering the resize clamp). This
  supersedes the original "detach + reattach" plan — reattach re-ran the
  reconstructed history replay (adr/0004) on every focus change, which
  re-materialized garbled scrollback for a long inline-TUI session (Claude Code
  renders in the normal buffer, so redraw frames pile into scrollback). Keeping
  the data pipe open means the replay fires exactly once per pane; live output
  just keeps appending. The control socket is the *only* thing toggled, since the
  board frees a pane's clamped size on control-socket close (`board.js`), so a
  spectator that closes it stops constraining the shared PTY without disturbing
  the byte stream.
