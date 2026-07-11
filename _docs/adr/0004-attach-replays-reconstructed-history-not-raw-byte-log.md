---
status: accepted
date: 2026-07-09
deciders: Lukas Van Houten (owner), Claude (advisor)
---

# 0004 — Attach replays reconstructed history, not the raw byte-log

## Context

On attach the board replayed a line's `s.buf` — the raw PTY byte-log, up to
`SCROLLBACK` (2000) chunks — verbatim to the joining client (`sb join`, the web
WS, `patch`). For a plain shell whose output is append-only that reproduces the
history faithfully. For anything that repaints with **cursor-relative** moves —
a shell with a redrawing prompt, or a normal-buffer TUI like Claude Code doing
"cursor up N lines, clear, redraw the input box" — it does not.

Those relative moves are only coherent at the terminal width they were emitted
at. The joiner's terminal is a faithful VT emulator, so replaying a log captured
at width A into a terminal at width B reproduces exactly the wrong screen: the
up-N moves assume A's wrap layout, so at B they land on the wrong rows and leave
characters from an earlier redraw un-overwritten. Symptom (reported 2026-07-09):
`sb join` a line, scroll, and "letters from a previous line stay on the current
line," cleared only by a manual resize — which works because the resize's
SIGWINCH makes the live app repaint its current frame at the new width. The
garble is intermittent because it only appears when the join width differs from
the capture width; join at the exact capture width and the replay is clean.

There is no escape-sequence patch for this: the relative moves are unrecoverable
without a grid model. A raw replay and a reconstruction *at the same width* are
identical — reconstructing only helps if it happens at the **capture** width and
emits width-independent flat lines the joiner then re-wraps itself.

The capture width is available: a line spawned `open:false` (web/MCP) and not yet
joined never resized (`applyMin` only fires when a pane joins/leaves), so its
whole buffer is single-width, and that width is the PTY's width right up until
*this* join's resize clamps it — which arrives a beat later on the separate
control pipe.

## Decision

**On each data-pipe attach the board reconstructs the history through a transient
`@xterm/headless` emulator + `SerializeAddon`, sized to the capture width, and
sends the serialized buffer instead of the raw byte-log.** (`reconstructReplay`
in `screen-render.js`; `attachWithReplay` in `board.js`.)

- **Capture width = the PTY width snapshotted synchronously at attach**, before
  the first await, so this join's own resize (control pipe, processed a turn
  later) hasn't clamped it yet. That is the width the buffered bytes were emitted
  at in the dominant case.
- **Transient, not the ADR-0002 emulator.** The reconstruction emulator is built
  and disposed per attach. It deliberately does **not** reuse or eager-init the
  lazy per-line screen emulator of ADR 0002 — that one is `scrollback:0` +
  plain-text and its "a line nobody screen-reads allocates nothing" invariant is
  left intact. Attaches are human/reconnect-scale, so a one-time parse of ≤2000
  chunks per attach (~tens of ms) is acceptable.
- **Scrollback preserved.** The reconstruction emulator keeps `REPLAY_SCROLLBACK`
  (5000) lines and the serializer emits the whole buffer, so join still shows
  what ran before you attached — unlike the current-screen-only *rendered
  screen*. This is the one place a very long session shows slightly less history
  than the old byte-log dump would have (bounded by that line cap).
- **Ordering is exact.** Reconstruction is async, so a socket authing is parked
  in `s.pending` (not `s.clients`) and live output produced during reconstruction
  is buffered per-socket; when the replay is ready it is written first, the
  queued live output flushed behind it, then the socket joins `s.clients`. A
  socket that drops mid-reconstruction (or a line that exits) is removed from
  `pending` and written nothing.
- **Fallback.** If reconstruction throws, the attach falls back to the raw
  byte-log (the pre-fix behavior) so a joiner still gets non-empty history.

## Consequences

- The `sb join` scroll-garble is fixed for the dominant case (a single-width
  line joined at a different width): the joiner re-wraps flat logical lines
  cleanly at its own width. The web terminal gets the same width-correct replay.
- **Residual, accepted:** a line whose buffer spans *multiple* widths (it was
  joined by a narrower pane earlier, which then left) reconstructs at one width,
  so segments captured at other widths can still garble — but never worse than
  the raw replay did, and the most-recent (largest, most-relevant) segment is
  clean. Fully correct multi-width history would require the board to maintain an
  always-on authoritative grid per line (the tmux/mosh model) fed live at the
  PTY's real width and serialized on attach — a larger change that reverses ADR
  0002's lazy invariant. Not taken; revisit if multi-width histories prove common.
- The board process gains a runtime dependency on `@xterm/addon-serialize`
  (declared in `server/package.json`, previously only hoisted via the client).
- Per-attach CPU rises from a byte dump to an emulator parse + serialize. Bounded
  by the 2000-chunk buffer and paid once per attach; a reconnect storm pays it
  per reconnect.
- Shipping this requires a board restart (ends every live line), like any board
  change. Tested against an isolated board on a separate pipe
  (`replay-reconstruction.e2e.test.js`, following `tombstone.e2e.test.js`); the
  width fix and the attach-ordering contract are proven by unit tests
  (`screen-render.test.js`, `board.test.js`).
