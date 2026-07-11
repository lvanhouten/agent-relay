# PRD — rendered-screen-read-output

## Problem Statement

An agent consumer that reads a switchboard line's output today gets the **raw
output** — the unmodified PTY byte stream (see CONTEXT.md). For a plain shell
that is the right artifact. For an alt-screen TUI like Claude Code it is
structurally wrong: the app repaints constantly, so the stream is ANSI escapes,
cursor jumps, and near-duplicate spinner frames, while the thing the consumer
actually wants — the **rendered screen** (what is on the grid right now) — is
small, stable, and never returned.

The concrete costs (a real 44-minute wedge on 2026-07-02):

- An agent reading a line stalled at a **permission dialog** sees frame smear
  indistinguishable from mid-build quiet — the exact misread that leaves a
  prompt unanswered for a whole idle threshold, or fires a needless wedge gate.
- **Bootstrap confirmation** ("did the session come up, did the prompt land")
  is pattern-matching through repaints.
- **Answering a dialog** is send-and-pray: the raw stream makes it hard to read
  which option is actually highlighted before and after sending a keystroke.

conduct-feature's LINE-OPS already works around this with a transcript-first
procedure, but the one moment the PTY is authoritative — the
waiting-vs-executing discriminator — still runs on the noisy artifact.

## Solution

Give the relay a second, additive read mode: the **rendered screen**. The board
maintains one headless VT emulator (`@xterm/headless`) per line, fed the same
PTY bytes it already broadcasts, and a new control command returns the current
grid as plain text plus the cursor position and dimensions. Agent consumers
reach it through a new `switchboard_read_screen` MCP tool and an `sb screen <id>`
CLI subcommand.

The result is deterministic: a bounded grid, no escapes, no duplicate frames —
exactly what a human sees on `sb join` — regardless of how much churn the stream
carried. A consumer can read *which dialog option is highlighted* (the `❯`
caret survives rendering) before sending a keystroke, and verify the selection
moved afterward. Raw output stays the default and is unchanged; rendered mode is
purely additive, for the alt-screen-TUI case where the stream is the wrong
thing. Placement and its trade-offs are recorded in ADR 0002.

## User Stories

1. As an agent driving a Claude line, I want to read the line's current rendered
   screen as plain text, so that I can tell what is on screen without parsing
   ANSI escapes and repaint frames out of the raw stream.
2. As an agent about to answer a permission dialog, I want to see which option
   the `❯` caret is on, so that I pick the intended option instead of sending a
   keystroke blind.
3. As an agent that just sent a keystroke to a menu, I want to re-read the screen
   and see the selection has moved, so that I can confirm the input landed before
   proceeding.
4. As an agent confirming a session bootstrapped, I want the rendered screen to
   show the settled prompt, so that "did it come up" is a direct read rather than
   pattern-matching through startup repaints.
5. As an agent, I want the rendered-screen read to return the cursor row/column
   and the grid dimensions alongside the grid, so that I have the positional
   facts without inferring them from text.
6. As an agent, I want the rendered-screen read to return a bounded payload no
   matter how long the line has been running, so that reading a busy line never
   dumps a huge scrollback.
7. As an operator at a terminal, I want an `sb screen <id>` command that prints
   the current grid in plain, human-readable form, so that scripts and I can
   consume the same rendered view agents do without opening a pane.
8. As an agent reading a plain shell or diffing output over time, I want
   `read_output` to keep returning the raw byte-stream delta unchanged, so that
   the rendered mode never disturbs the linear-output use cases.
9. As an agent that reads the screen of an unavailable line, I want the error to
   tell me *why* — the line has ended (and its exit code) versus no such line
   ever existed — so that I can tell "it finished" from "I have the wrong id"
   instead of guessing.
10. As an agent reading a line whose terminal was resized, I want the rendered
    grid to match the line's current dimensions, so that the layout is not
    sheared and the `❯` lands where the app actually drew it.

(An efficiency invariant — a line never screen-read allocates no emulator — is a
non-functional property captured under Implementation Decisions and verified by
the lifecycle unit test, not a blind behavioral assertion; see Testing Decisions
and Further Notes.)

## Implementation Decisions

**Placement (ADR 0002):** the board owns the rendered screen. It already owns
the PTY bytes, the scrollback (`s.buf`), the size (it is the only component that
sees resize events), and the lifecycle — so the emulator lives beside them, not
in a consumer. Consumers never render; they ask the board over the control
plane. Board-restart friction to ship this is explicitly accepted.

**Module 1 — `screen-render.js` (new, deep, pure-testable).** Hides
`@xterm/headless` entirely behind:
`createScreen(cols, rows) -> { write(bytes), resize(cols, rows), snapshot(), dispose() }`.
`snapshot()` returns `{ grid, cursor: { row, col }, cols, rows }`:
- `grid` = the active buffer's visible rows joined by `\n`, each row
  **right-trimmed** of trailing whitespace, with **trailing all-blank rows
  dropped**; interior and leading spaces preserved (layout).
- `cursor.row` / `cursor.col` in the **untrimmed** grid coordinate space
  (0-based), as reported by the emulator.
- `cols` / `rows` = the emulator's current dimensions.
- `snapshot()` must **flush** any pending `write()`s before reading the buffer:
  `@xterm/headless`'s `write` is asynchronous (parsed on a later tick), so the
  module writes with the completion callback and resolves the snapshot only once
  the parser has drained, or drives xterm such that reads observe all prior
  writes. This is the one correctness-critical detail of the module.
- **Serialization assumption (stated, spike-checked):** the live feed
  (`p.onData` → `write`) and a `snapshot()`'s flush-then-read run on the same
  Node event loop, and `@xterm/headless` applies each `write` atomically between
  ticks — so a snapshot taken during active output reflects a consistent grid
  at some write boundary, never a half-applied (torn) frame. The module must not
  read the buffer mid-parse. The spike confirms this holds under a live,
  actively-repainting Claude line.
- Emulator scrollback is configured to 0 — only the live grid matters.

**Module 2 — `board.js` per-line screen lifecycle (modify).** A
`makeScreenManager`-style helper (mirroring the existing `makeEndedRegistry` /
`makeRunFeeder` factoring) owns one screen per line, so the lazy-init / feed /
resize / dispose logic is unit-testable without spawning a PTY. Wiring:
- **Lazy-init:** the emulator is created on the **first** `screen` command for a
  line — constructed at the line's current PTY size, then seeded by replaying
  the existing `s.buf` into it, after which it tracks live. A line never
  screen-read allocates nothing. **Residual first-read exposure (see ADR 0002):**
  seeding assumes the current frame is within the 2000-chunk scrollback window —
  bounded and spike-validated, not eliminated; every read after init is exact.
- **Live feed:** once initialized, `p.onData` writes each chunk to the screen
  (beside the existing `s.buf.push` / client broadcast).
- **Resize:** the `resize` handler (which already calls `applyMin`) resizes the
  screen to the line's clamped PTY size, so the grid never shears.
- **Dispose:** `p.onExit` disposes the screen and drops the per-line reference.
- **New `handle()` case `'screen'`:** `{ cmd: 'screen', id }` → if the line is
  live, lazy-init if needed and reply `{ ok: true, boot: BOOT, grid, cursor,
  cols, rows }`. If the line is not live, the handler **consults the existing
  `endedLines` tombstone registry** (the same source `list` / `forget` use) to
  distinguish two cases: an **exited** line replies `{ ok: false, ended: true,
  exitCode, reason }` (from the tombstone); an id that **never existed** replies
  `{ ok: false, ended: false }`. The reply carries `boot` for consistency with
  `new` / `list`; there is no read cursor to namespace (snapshot, not delta).

**Module 3 — `switchboard_read_screen` MCP tool (modify `mcp-server.js`).**
Input `{ id }`. Calls `boardRpc({ cmd: 'screen', id })`. On `ok: true`, returns
`JSON.stringify({ grid, cursor, cols, rows })` as text content. On `ok: false`,
returns `isError: true` with a message that **distinguishes** the two failure
modes the board reports: `ended: true` → "line <id> has ended (exit <code>)";
`ended: false` → "no such line: <id>". An RPC-level error maps to a generic read
failure. No read-cursor cache and no `seen`/`observeBoot` bookkeeping — a screen
read is a stateless snapshot, unlike `read_output`'s delta. `read_output` /
`read_screen` are two distinct tools with distinct schemas; there is no
`screen:true` param on `read_output`.

**Module 4 — `sb screen <id>` subcommand (modify `sb.js`).** Adds a `screen`
case and a HELP line. `rpc({ cmd: 'screen', id })`; on `ok: true` print `r.grid`
to stdout (real newlines, `❯` in place); on `ok: false` print the distinguishing
message — "line <id> has ended (exit <code>)" when `ended`, else "no such line:
<id>". Thin dispatch mirroring `sb end` / `sb list`.

**Module 5 — `@xterm/headless` dependency (modify `server/package.json`).**
Added beside `node-pty`; the board resolves deps from the `server` workspace.

**De-risking spike (first build step):** before the rest, confirm
`@xterm/headless` `require()`s in the CommonJS board process; that a real Claude
permission-dialog frame renders with `❯ 1. Yes` intact (the active/alt buffer is
the one serialized); and that a `snapshot()` taken while the emulator is being
actively fed returns a consistent (untorn) grid. Everything else depends on
these holding; if they fail, the placement (ADR 0002) is revisited before more
is built.

**Facts, not verdicts:** `read_screen` returns grid + cursor + dims only. No
`state`/`dialog` hint — the relay stays TUI-agnostic and never pattern-matches a
specific TUI's chrome; classifying the screen belongs to the consumer.

## Testing Decisions

Good tests here assert **external behavior** — the shape and content of a
rendered snapshot given known input bytes, and the error behavior of the read
surfaces — never `@xterm/headless` internals. Prior art: `board.test.js` (pure
helpers like `makeRunFeeder` / `makeEndedRegistry` driven with injected
clocks/IO), `lib.test.js`, `mcp-server.test.js` (RPC-injected via `__setRpc`),
and the isolated-board integration pattern in `tombstone.e2e.test.js` /
`env-injection.e2e.test.js` (spawn a real board on an `AGENT_RELAY_PIPE`
namespace, drive it, clean up pipe + secret file in `t.after`).

- **`screen-render.js` (parallel-safe).** Unit tests: feed a known escape/text
  sequence, assert the serialized grid — right-trim, trailing-blank-row drop,
  interior-space preservation, cursor row/col in untrimmed coords, and a
  sequence containing `❯` renders it in the expected cell. Runs in isolation, no
  board or PTY.
- **`makeScreenManager` lifecycle helper (parallel-safe).** Unit tests with
  injected screen/IO (mirroring `makeRunFeeder`'s injected clock): lazy-init on
  first access seeds from the provided buffer, subsequent writes feed the same
  instance, resize forwards dimensions, dispose releases and a post-dispose
  access re-inits or reports gone. This helper is also where the **efficiency
  invariant** (a line never screen-read allocates no emulator — a white-box
  resource property, not a blind behavioral assertion) is verified: no
  construction occurs until first access. No PTY.
- **`screen` control command (exclusive — needs a real board + PTY).**
  Integration test on the `tombstone.e2e.test.js` template: spawn an isolated
  board, create a line running a command with deterministic screen output, RPC
  `{ cmd: 'screen', id }`, assert the returned grid/cursor/dims; RPC `screen`
  for an id that never existed returns `{ ok: false, ended: false }`; screen of
  an ended line returns `{ ok: false, ended: true }` with its `exitCode` — the
  two failure modes are asserted **distinct**, not merely both falsy. Exclusive
  because it binds a real named pipe and spawns a PTY.
- **`switchboard_read_screen` error mapping (parallel-safe).** Unit test via the
  `__setRpc` seam: `ok: true` → JSON text content with the four fields;
  `{ ok: false, ended: true, exitCode }` → `isError` with the "has ended (exit
  N)" message; `{ ok: false, ended: false }` → `isError` with the "no such line"
  message — the two mapped messages asserted distinct. No live board.
- **`sb screen` (no dedicated test).** Thin CLI dispatch with no logic, matching
  the existing untested `sb` subcommands; exercised in practice via the spike
  and the integration test's board.

## Out of Scope

- **Session-card live previews.** The same per-line rendered screen is the
  natural feed for client card previews (`2026-07-01-session-card-live-preview.md`),
  but the client-side consumer is deferred to that issue. This feature is the
  agent-read path only.
- **A `state`/`dialog` classification hint.** Deliberately not built — facts
  only (see Implementation Decisions). Revisited only if a consumer proves it
  needs a hint the relay is uniquely positioned to give.
- **A `screen:true` param on `read_output`.** Rejected in favor of a separate
  tool; `read_output`'s delta semantics and the screen's snapshot semantics do
  not compose.
- **Retaining a final screen for exited lines.** Reading the screen of an exited
  line is an error, not a stored last-frame; the transcript holds history.
- **Web-tier / REST / `BoardSessions` surface.** No `/api` or session-DTO change;
  the rendered screen is exposed on the board control plane and its two agent
  consumers (MCP, `sb`) only.
- **Changing `read_output`.** Raw-output reads are untouched.

## Further Notes

- **Emulator fidelity is the one empirical risk.** Claude Code uses the
  alternate screen buffer, wide glyphs, and heavy color. `@xterm/headless`
  handles these, but the spike validates it against a live Claude line before
  the rest is trusted — specifically that markers like `❯ 1. Yes` survive
  rendering and that the active buffer is the one serialized.
- **Sizing depends on the board's clamp.** The PTY size is the min across
  patched panes (`applyMin`), so the screen tracks the clamped size; a snapshot
  reflects whatever dimensions the app is currently drawing to.
- **Efficiency invariant (non-functional).** A line that is never screen-read
  allocates no emulator; the capability is inert until a line's first screen
  read. This is a resource property, not an externally observable behavior, so
  it lives here and in the `makeScreenManager` unit test rather than as a
  validation-contract assertion.
- **Complements the transcript, never replaces it.** The verbatim command text a
  consumer needs (e.g. what a permission dialog is asking to run) wraps and
  scrolls off the visible grid, so it comes from the session transcript; the
  rendered screen supplies current UI state. See the cross-references in the
  source issue.
