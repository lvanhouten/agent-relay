## Agent Brief

**Category:** enhancement
**Summary:** A `switchboard_read_screen` MCP tool that returns a line's rendered screen

**Current behavior:**
The MCP server exposes tools for line access: create, list, read output, send
input, end. `switchboard_read_output` returns the raw PTY byte-stream **delta**
since the last read — a cursor-tracked tail, with `tailChars` / `full` controls
and boot-nonce bookkeeping. There is no MCP tool that returns the *rendered
screen* (current grid), so an agent reading an alt-screen TUI's state must parse
repaint churn out of the raw delta.

**Desired behavior:**
Add a `switchboard_read_screen` MCP tool that returns a line's current rendered
screen. It is a thin, **stateless snapshot** read over the board's `screen`
control command (brief 02) — deliberately unlike `read_output`: no read cursor,
no `tailChars` / `full`, no `seen` / boot-nonce tracking.

- Input: a line `id`.
- On the board replying `ok: true`: return the snapshot fields
  (`grid`, `cursor`, `cols`, `rows`) as JSON text content, so a programmatic
  consumer can read the grid plus the positional facts without re-parsing.
- On the board replying `ok: false`: return an **error** result whose message
  **distinguishes** the two failure modes the board reports —
  `ended: true` → a message naming the line as ended and including its exit code
  (e.g. "line <id> has ended (exit <code>)"); `ended: false` → a message naming
  it as no such line (e.g. "no such line: <id>"). An RPC-level failure maps to a
  generic read-failure error.

`switchboard_read_output` and its raw-delta semantics must be left **completely
unchanged** — this brief adds a sibling tool, it does not modify the existing
one. The two are distinct tools with distinct schemas; there is no `screen`
parameter added to `read_output`.

**Key interfaces:**

- `switchboard_read_screen` — new MCP tool; input `{ id }`; success returns the
  `{ grid, cursor, cols, rows }` snapshot as JSON text; failure returns an
  `isError` result with the distinguishing message.
- The board `screen` reply contract from brief 02 — `{ ok, grid, cursor, cols,
  rows }` on success; `{ ok: false, ended, exitCode, reason }` on failure. This
  tool consumes it via the shared control-RPC seam the MCP server already uses
  for its other tools.

**Acceptance criteria:**

- [ ] `switchboard_read_screen` is registered with an `id` input and a
      description that positions it as the rendered-screen read (vs
      `read_output`'s raw delta).
- [ ] A successful read returns the `grid`, `cursor`, and `cols`/`rows` as JSON
      text content.
- [ ] A read of an **ended** line returns an error whose message names it ended
      and includes the exit code.
- [ ] A read of a **never-existed** id returns an error whose message names it as
      no such line — asserted **distinct** from the ended-line message.
- [ ] `switchboard_read_output` behavior is unchanged: it still returns the raw
      byte-stream delta (cursor/tail semantics intact), not a rendered grid.
- [ ] Unit tests cover the success mapping and both distinct failure mappings via
      the MCP server's existing injectable-RPC test seam (no live board). Prior
      art: the existing MCP server tests that swap the board RPC.

**Out of scope:**

- The board `screen` command and per-line emulator (brief 02) and the
  `screen-render` module (brief 01).
- The `sb screen` CLI (brief 04).
- Any change to `switchboard_read_output`, `switchboard_send_input`, or the
  other existing tools.
- Any `state` / `dialog` hint, session-card previews, or web/REST surface.

**Depends on:** 02-board-screen-command (consumes the `screen` reply contract)

**Covers:** VC-9, VC-10, VC-11

**Runtime:** parallel-safe
