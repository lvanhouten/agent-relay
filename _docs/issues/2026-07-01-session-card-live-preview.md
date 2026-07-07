# Session cards have no live output preview

**Source:** Came up while removing a dead preview widget on the sessions screen — the card used to render a small terminal-output thumbnail, but the data to fill it was never wired through the server, so it always showed a "no output yet" placeholder. The dead widget was removed; wiring a real preview is the enhancement captured here.
**Status:** ⏸ Deferred — 2026-07-01. **Absorbed 2026-07-07** into desktop shell slice 3 (`2026-07-07-desktop-fleet-extras.md`) — the "tail in the `list` reply" approach outlined here is carried forward there; this doc keeps the original analysis.
**Kind:** Enhancement
**Modules:** client/SessionsScreen, server/sessions, board
**Severity:** Low

## What's already been closed

The permanently-empty `TerminalPreview` widget and its `session.preview` prop were removed from `client/src/screens/SessionsScreen.jsx`, so the UI no longer implies a working feature that doesn't exist. Cards now show name, status, cwd, shell, pid, and last-active without a fake output thumbnail.

## What remains

There is no live output preview on a session card. The underlying data exists: the board keeps a 2000-chunk scrollback per line (`server/board/board.js`, `SCROLLBACK = 2000`), but nothing surfaces a tail of it to the sessions list. To show a real preview, the server DTO would need a `preview` field that neither `toDto()` nor `spawn()` in `server/src/sessions.js` currently populates.

## Fix outline

- Decide the preview source: cheapest is to have the board's `list` reply include a short scrollback tail per line (last N chunks, capped in bytes) so the existing 5s poll carries it — avoid opening a data-pipe read per card per poll, which would be N sockets every 5s. (medium)
- Thread the tail through `toDto()` in `server/src/sessions.js` into a `preview` array field. (small)
- Re-add a `TerminalPreview`-style component to the card and feed it `session.preview`. (small)
- Cross-cutting risk: strip ANSI escape codes before display, and cap the byte size in the `list` reply so a chatty line doesn't bloat every poll response for every card.

## Trigger signals to reopen

- A user or stakeholder asks to see session output at a glance without attaching.
- The sessions list grows large enough that "which session is doing what" becomes a real navigation problem.
- Any redesign of the session card that would benefit from an activity indicator richer than the idle-time clock.

## Repro

1. Open the sessions screen with one or more active sessions (before removal).
2. Observe every card's preview area reads "no output yet" regardless of how much the session has actually produced — because `session.preview` is `undefined` in the DTO the server sends.
