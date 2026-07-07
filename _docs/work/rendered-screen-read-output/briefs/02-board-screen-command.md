## Agent Brief

**Category:** enhancement
**Summary:** The board maintains a per-line rendered screen and answers a new `screen` control command

**Current behavior:**
The board daemon owns every line's PTY, keeps a capped scrollback of output
chunks, broadcasts each chunk to attached clients, and is the only component
that sees PTY resize events. It exposes control commands (`new`, `list`, `join`,
`end`, `forget`, `resize`, `shutdown`) over its control pipe. It maintains a
capped tombstone registry of recently-ended lines (used by `list` / `forget`) so
callers can tell "ended, and how" from "never existed." There is no way to ask
the board for a line's rendered screen — a consumer can only attach to the raw
data pipe and parse the byte stream itself.

**Desired behavior:**
The board maintains one rendered screen per line (via the `screen-render` module
from brief 01) and answers a new `screen` control command with the current grid.
Building on the existing per-line state and lifecycle:

- **Lazy-init.** A line's screen emulator is created on the **first** `screen`
  command for that line — never before — so a line that is never screen-read
  allocates nothing. At init it is sized to the line's current PTY dimensions and
  **seeded** by replaying the line's existing scrollback buffer into it, so the
  first read already reflects the current frame. (Residual, accepted risk: the
  current frame must sit within the scrollback window; every read after init is
  exact.)
- **Live feed.** Once initialized, every subsequent PTY output chunk is written
  to the screen alongside the existing scrollback-append and client-broadcast.
- **Resize tracking.** When the line's PTY is resized (the same path that clamps
  to the smallest attached pane), the screen is resized to match, so the grid
  never shears.
- **Dispose.** When the line exits, its screen is disposed and the per-line
  reference dropped.
- **`screen` control command.** Given a line id:
  - If the line is **live**: lazy-init the screen if needed, then reply
    `{ ok: true, ...boot, grid, cursor, cols, rows }` (the snapshot fields from
    brief 01, plus the board's boot nonce for consistency with `new` / `list`).
  - If the line is **not live**: consult the existing tombstone registry (the
    same source `list` / `forget` use). An **exited** line replies
    `{ ok: false, ended: true, exitCode, reason }` (from its tombstone); an id
    that **never existed** replies `{ ok: false, ended: false }`. These two
    failure replies must be distinguishable by the caller.

There is no read cursor to track — a screen read is a stateless snapshot, unlike
the delta-based raw-output read.

Factor the per-line screen lifecycle (lazy-init / seed / feed / resize / dispose)
into a small helper with its emulator-factory and IO injected, mirroring how the
board already factors testable helpers (the initial-command feeder and the
tombstone registry), so the lifecycle is unit-testable without spawning a PTY.
This helper is also where the efficiency invariant is verified: no emulator is
constructed until first access.

**Key interfaces:**

- Board `screen` control command — request `{ cmd: 'screen', id }`; reply shapes
  as above. This reply contract is what the MCP tool (brief 03) and `sb` (brief
  04) consume — keep the field names exact: `ok`, `grid`, `cursor` (`{ row, col }`),
  `cols`, `rows`, and on failure `ended` (boolean) plus `exitCode` / `reason`
  when `ended` is true.
- `createScreen(cols, rows) → { write, resize, snapshot, dispose }` — consumed
  from brief 01's `screen-render` module.
- A per-line screen-lifecycle helper (lazy-init/seed/feed/resize/dispose) with
  injected emulator factory + IO, exported for unit testing (prior art: the
  board's existing injected-IO helpers).

**Acceptance criteria:**

- [ ] A `screen` command for a live line returns `ok: true` with a `grid`,
      `cursor` `{row, col}`, and `cols`/`rows` matching the line's PTY size.
- [ ] The emulator for a line is created only on the first `screen` command for
      that line; a line never screen-read constructs no emulator (verified via
      the lifecycle helper's injected factory).
- [ ] The first `screen` read of a line that already produced output returns
      that output's rendered screen (seeded from scrollback).
- [ ] After further PTY output, a subsequent `screen` read reflects the newer
      screen state (live feed keeps the emulator current).
- [ ] After the line's PTY is resized, a `screen` read returns a grid whose
      dimensions match the new size and whose content is laid out to that width.
- [ ] A `screen` command for an id that never existed returns
      `{ ok: false, ended: false }`.
- [ ] A `screen` command for a line that has exited returns
      `{ ok: false, ended: true }` including its `exitCode` — asserted **distinct**
      from the never-existed reply, not merely both falsy.
- [ ] When a line exits, its screen emulator is disposed.
- [ ] The lifecycle helper has unit tests (injected factory/IO, no PTY) covering
      lazy-init-with-seed, live feed to the same instance, resize forwarding, and
      dispose. Prior art: the board's existing injected-IO helper tests.
- [ ] An integration test on an isolated board (its own pipe namespace, spawned
      as a child, cleaned up in teardown — prior art: the board's tombstone /
      env-injection e2e tests) drives a real line with deterministic output and
      asserts the `screen` reply's grid/cursor/dims, plus the two distinct
      failure replies. **Every board RPC in the test and its teardown must use
      the isolated pipe namespace — a bare RPC hits the production board.**

**Out of scope:**

- The `switchboard_read_screen` MCP tool (brief 03) and `sb screen` (brief 04) —
  this brief stops at the board control command.
- The VT-emulator / serializer internals — owned by brief 01.
- Any `state` / `dialog` hint in the reply — facts only.
- Retaining a final rendered screen for exited lines — an exited line's `screen`
  read is a failure reply, not a stored last frame.
- Any change to the raw-output data-pipe path, scrollback, or existing control
  commands beyond adding `screen` and the resize/exit hooks.

**Depends on:** 01-screen-render (consumes `createScreen`)

**Covers:** VC-3, VC-4, VC-7, VC-9, VC-10

**Runtime:** exclusive
