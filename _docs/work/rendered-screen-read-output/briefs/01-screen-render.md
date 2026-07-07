## Agent Brief

**Category:** enhancement
**Summary:** A pure `screen-render` module that turns a PTY byte stream into a rendered terminal grid, backed by a headless VT emulator

**Current behavior:**
The relay has no way to turn a line's raw PTY output (the byte stream — text
interleaved with ANSI escapes, cursor moves, repaint frames) into the *rendered
screen* (the current terminal grid a human would see on `sb join`). Consumers
that want to know "what is on screen right now" must parse the raw stream
themselves, which is unreliable for an alt-screen TUI that repaints constantly.
No VT-emulator dependency is present in the server workspace.

**Desired behavior:**
Introduce a self-contained module that hides a headless VT emulator
(`@xterm/headless`) behind a small interface, so a caller can feed it PTY bytes
and read back the current grid as plain text plus positional facts. The module
owns *only* the byte-stream → grid transform; it knows nothing about the board,
pipes, lines, or any specific TUI. It is the single place the VT-emulator
dependency is used.

A snapshot returns the **rendered screen** (see the CONTEXT.md glossary):
- The active buffer's visible rows joined by `\n`.
- Each row **right-trimmed** of trailing whitespace; **trailing all-blank rows
  dropped** entirely; leading and interior spacing that positions content
  **preserved**.
- The **cursor** row and column (0-based, in the untrimmed grid coordinate
  space, as the emulator reports it).
- The current **dimensions** (columns and rows).

Correctness details that must hold:
- **No escapes in the grid.** The returned text contains only rendered
  characters — no ANSI escape sequences or cursor-control codes.
- **Flush before read.** `@xterm/headless`'s write is asynchronous (parsed on a
  later tick); a snapshot must observe all writes issued before it — write with
  the completion callback (or otherwise drive the emulator) so the buffer is
  fully parsed before it is serialized. Never read the buffer mid-parse.
- **Untorn under active feed.** A snapshot taken while writes are still arriving
  returns a consistent grid at some write boundary, never a half-applied frame.
  (Node's single event loop plus xterm applying each write atomically between
  ticks makes this achievable; the module must not defeat it.)
- **Bounded.** Emulator scrollback is configured to 0 — only the live grid
  matters — so a snapshot's size is bounded by the dimensions regardless of how
  much output has been fed.
- **Fidelity.** A real alt-screen TUI frame (e.g. a Claude Code permission
  dialog with a `❯ 1. Yes` selection caret) renders with the caret intact on the
  highlighted option, and the *active* (alternate) buffer is the one serialized.

**De-risking spike — do this FIRST, before building the serializer.** This
whole feature's placement depends on the emulator working in this process; if
any of these fail, stop and report rather than building on. Confirm:
1. `@xterm/headless` can be loaded from the CommonJS server workspace (a plain
   `require` succeeds; no ESM-only / DOM-only blocker).
2. Feeding a captured (or representative) alt-screen dialog frame renders
   `❯ 1. Yes` intact in the expected cell.
3. A snapshot taken while the emulator is being actively fed returns an untorn
   grid.

**Key interfaces:**

- `createScreen(cols, rows)` — factory returning a handle with:
  - `write(bytes)` — feed a chunk of PTY output.
  - `resize(cols, rows)` — change the grid dimensions.
  - `snapshot()` — return `{ grid, cursor: { row, col }, cols, rows }` per the
    rules above (may be async to honor the flush requirement).
  - `dispose()` — release the emulator and its resources.
- `@xterm/headless` — new runtime dependency, declared in the server workspace's
  package manifest alongside the existing PTY dependency (the board resolves its
  dependencies from that workspace).

**Acceptance criteria:**

- [ ] The spike's three checks pass and are recorded (dependency loads in CJS,
      `❯ 1. Yes` renders intact, snapshot untorn under active feed).
- [ ] `@xterm/headless` is declared as a dependency in the server workspace
      manifest.
- [ ] `createScreen` exposes `write` / `resize` / `snapshot` / `dispose`.
- [ ] Feeding a known escape+text sequence and calling `snapshot()` returns a
      `grid` string with no ANSI escape sequences in it.
- [ ] A sequence containing a `❯` selection caret renders the caret in the
      expected cell of the grid.
- [ ] `snapshot()` right-trims trailing whitespace per row, drops trailing
      all-blank rows, and preserves leading/interior spacing.
- [ ] `snapshot()` returns the cursor row/col (untrimmed coords) and the current
      cols/rows dimensions.
- [ ] After `resize(newCols, newRows)`, a subsequent `snapshot()` reflects the
      new dimensions and lays content out to the new width.
- [ ] A snapshot's size stays bounded by the dimensions regardless of how much
      output was written (scrollback does not accumulate).
- [ ] Unit tests cover the serializer behaviors above and run in isolation (no
      board, no PTY, no pipes). Prior art: the pure-helper tests in the board's
      test suite (`board.test.js`, `lib.test.js`).

**Out of scope:**

- Any board, pipe, line-lifecycle, or `p.onData` wiring — that is brief 02.
- The `switchboard_read_screen` MCP tool (brief 03) and `sb screen` (brief 04).
- Any `state` / `dialog` classification hint — the module returns facts only and
  must not pattern-match a specific TUI's chrome.
- Session-card previews, the web/REST tier, and any change to raw-output reads.

**Depends on:** none

**Covers:** VC-1, VC-2, VC-4, VC-5, VC-6

**Runtime:** parallel-safe
