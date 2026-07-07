---
status: accepted
date: 2026-07-07
deciders: Lukas Van Houten (owner), Claude (advisor)
---

# 0002 — Board-owned rendered screen via a per-line headless VT emulator

## Context

`read_output` returns the raw PTY byte stream (the *raw output* — see
CONTEXT.md). For an alt-screen TUI like Claude Code that is structurally the
wrong artifact: the stream is repaint churn, while the thing every agent
consumer wants — the *rendered screen* (the current grid) — is small, stable,
and never returned. This cost a real 44-minute wedge (2026-07-02) and forced
conduct-feature's LINE-OPS onto a transcript-first workaround whose weakest
link is exactly this read.

To turn a byte stream into a correct grid you need two inputs: the **bytes** and
the **current PTY size**. Any consumer can already get the bytes (the board
replays the full `s.buf` scrollback to anyone who attaches). Only the board
knows the size — it allocated the PTY and is the sole component that sees resize
events (`applyMin`). Render at the wrong width and the grid shears, defeating
the whole point (you can't trust which option the `❯` is on).

Two placements were weighed:

- **Consumer-side render-on-demand** — a shared pure lib renders the replayed
  scrollback through a throwaway emulator per read; the board changes only to
  export its size. Keeps the daemon nearly untouched (iterate under `--watch`,
  no restart). But it re-renders from up to 2000 chunks per read, and carries an
  *unmeasured truncation risk*: a long-quiet line's last repaint could fall out
  of the scrollback window, rendering a stale or half-screen.
- **Board-side persistent emulator** — the board owns bytes, size, and
  lifecycle, so it also owns the screen. Cheap per read (dump the current grid),
  and truncation-free once the emulator exists (fed incrementally thereafter).
  Its only real cost is deploy friction: shipping a board change means
  restarting the daemon, which ends every live line.

## Decision

**The board maintains one headless VT emulator (`@xterm/headless`) per line and
owns the rendered screen.** A new `screen` control command returns the current
grid. Consumers (`switchboard_read_screen`, `sb screen <id>`) never render — they
ask the board.

- The emulator is **lazy-initialized** on the first screen read of a line:
  constructed at the line's current PTY size, seeded by replaying the existing
  `s.buf`, then fed live in `p.onData` and resized by the existing resize path.
  Lines nobody screen-reads allocate nothing. The seeding means the **first**
  read of a line that ran unread carries a bounded version of the
  consumer-side truncation exposure — the current frame must sit within the
  2000-chunk scrollback window; every read after init is exact. This is
  acceptable (a repainting TUI's current frame is far inside that window) and is
  a spike validation point, not an eliminated risk.
- Emulator scrollback is 0 (only the live grid matters); the instance is
  disposed on `p.onExit`. Reading the screen of an exited line is an error
  (mirrors `read_output`'s EREADCLOSED / the gone data pipe) — a dead process
  has no current screen; the transcript holds the history.

The **deploy-friction cost is explicitly accepted by the owner** — board
restarts are tolerable here, which removes the only material argument against
this placement and tips it decisively over the consumer-side alternative.

## Consequences

- Screen state lives in the daemon that already owns the stream and the size, so
  the render is correct and cheap; the consumer-side truncation risk is retired
  for every read after init, and reduced to a bounded, spike-validated exposure
  on the first read (the seed-from-scrollback step above).
- The board process gains a runtime dependency (`@xterm/headless`) and a small,
  bounded amount of memory per *screen-read* line. Untouched lines pay nothing.
- Shipping this — and any later change to it — requires a board restart, which
  ends every live line. Board changes are tested against an isolated board on a
  separate pipe (`AGENT_RELAY_PIPE`; `tombstone.e2e.test.js` is the template),
  not the production daemon.
- The relay stays TUI-agnostic: it renders *a* grid and returns *facts* (grid,
  cursor, dims), never a `state`/dialog verdict. Classifying "this is a Claude
  permission dialog" belongs to the consumer that knows what it spawned — the
  relay never pattern-matches a specific TUI's chrome. (Revisit only if a
  consumer proves it needs a hint the relay is uniquely positioned to give.)
- The same per-line screen is the natural feed for session-card live previews
  (`2026-07-01-session-card-live-preview.md`); building the emulator here serves
  that later consumer, though card preview is out of this feature's scope.
