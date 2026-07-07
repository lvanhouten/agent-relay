# Desktop shell v2 — spectator attach + pane grid

**Source:** Slice 2 of `2026-07-02-desktop-workspace-shell.md`, sliced 2026-07-07. The desktop killer feature: watching a fleet of agent sessions run side by side.
**Status:** 💡 Proposed — 2026-07-07. Depends on slice 1 (`2026-07-07-desktop-shell-v1-master-detail.md`) for the shell to host it, and on the spectator ADR decided during slice 1's grill.
**Kind:** Enhancement
**Modules:** board (`list` reply), server/ws (spectator mode), client core (`TerminalView` spectator mode), DesktopShell (grid)
**Severity:** High value / medium-large effort. The only server-touching slice.

## Motivation

The board clamps a mirrored line's PTY to its *smallest* attached client (`applyMin`, `board.js`), so a grid of small panes would shrink every session's real PTY and garble the layout for the agent running in it. And it's subtler than "don't send resize": a spectator's local xterm still has *some* column count, and if it differs from the PTY's real dims, cursor-positioned TUI output (Claude Code's own UI — exactly what you'd be watching) garbles locally. The clean render is thumbnail-style: set the local terminal to the PTY's actual cols/rows and CSS-scale the canvas to fit the pane.

**The clamp mechanics are friendlier than the umbrella doc feared** (verified 2026-07-06): sizes are keyed per control socket (`board.js` `resize` handler), cleaned on socket close, and a client that never sends `resize` simply never enters the clamp. So "spectator" server-side is mostly *not sending resize*, plus defense-in-depth dropping it at the web tier.

## Proposal outline

- **Board: PTY dims in the `list` reply** — carry current `cols`/`rows` per line (read off the pty object; verify node-pty exposes live dims post-resize). Additive field, same pattern as `ended`. The one board change — a board restart ends every line, so land it alone and deliberately. (small)
- **`ws.js`: `?mode=spectator`** — tag the connection at upgrade; drop inbound `input`/`resize` frames server-side (dropped, not errored). Deliberately the same no-input/no-resize semantics scoped tokens' `read` class needs (`2026-07-02-scoped-tokens.md`) — one design, two consumers; scoped tokens later reuses this frame filter with a token-derived scope instead of a query param. (small)
- **`TerminalView` spectator mode** — implement the already-declared `'spectator'` axis (`core/types.ts`): adopt the reported PTY dims, CSS-scale the canvas to the pane, never fit, never send resize. Dim changes propagate via the existing 5 s poll — thumbnails lagging a resize by ≤5 s is acceptable. (medium)
- **Pane grid in `DesktopShell`** — 2+ terminals side by side via an adopted layout library (`react-resizable-panels` or `dockview` — umbrella ADR: don't hand-roll docking). Unfocused panes attach as spectators; the focused pane reattaches interactive and owns sizing. (medium-large)

## Risks / open questions

- **Focus-switch reattach is the riskiest interaction**: focusing a pane means WS teardown + reattach + full scrollback replay. `TerminalView` already resets-before-replay on reconnect, so it should be clean — but N-pane focus-thrashing needs testing. An alternative (mode-switch frame on a live socket) adds protocol; only reach for it if reattach proves janky.
- Data-pipe fan-out: N visible panes = N WS connections = N board data pipes replaying 2000-chunk scrollbacks on every layout change. Cheap locally, but worth an eye on attach storms.
- The live-preview card tail (`2026-07-01-session-card-live-preview.md`, folded into slice 3) remains the right answer for *many small* previews — real spectator attaches are for a handful of panes, not a wall of cards.

## Trigger signals to prioritize

- Slice 1 has landed and the master–detail workspace is in daily use.
- First "I want to watch two agents at once" moment — the full-repo-audit / conduct-feature fleet pattern already generates it.
