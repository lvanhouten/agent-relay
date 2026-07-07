## Agent Brief

**Category:** enhancement
**Summary:** An `sb screen <id>` CLI subcommand that prints a line's rendered screen

**Current behavior:**
The `sb` CLI drives lines over the board control plane: `up`, `new`, `list` /
`ls`, `join`, `end`, `wait`, `down`, `help`. Each subcommand issues a control
RPC and prints a human-readable result. There is no way to print a line's
rendered screen from the terminal without opening a pane (`sb join`); a script
or operator that just wants "what's on the screen right now" has no one-shot
command.

**Desired behavior:**
Add an `sb screen <id>` subcommand that prints the line's current rendered screen
in plain, human-readable form and exits — the human-facing counterpart to the
`switchboard_read_screen` MCP tool (brief 03), consuming the same board `screen`
command (brief 02).

- On the board replying `ok: true`: print the `grid` to standard output with
  **real line breaks** (not JSON-escaped) and the selection caret (`❯`) in place
  — i.e. what a human would see on `sb join`.
- On the board replying `ok: false`: print a distinguishing message — "line
  <id> has ended (exit <code>)" when `ended`, else "no such line: <id>".
- Missing id: a usage message, matching how the other subcommands handle a
  missing argument.
- Add the subcommand to the CLI's HELP text.

Thin command dispatch with no business logic, mirroring the existing `sb end` /
`sb list` subcommands.

**Key interfaces:**

- `sb screen <id>` — new CLI subcommand; issues `{ cmd: 'screen', id }` over the
  shared control RPC and prints `grid` on success / the distinguishing message on
  failure.
- The board `screen` reply contract from brief 02 (`{ ok, grid, ... }` /
  `{ ok: false, ended, exitCode }`).
- The CLI HELP text — gains a `screen` line.

**Acceptance criteria:**

- [ ] `sb screen <id>` for a live line prints its rendered grid to stdout with
      real newlines and the `❯` caret in place.
- [ ] `sb screen <id>` for an ended line prints a message naming it ended with
      its exit code; for a never-existed id, prints "no such line: <id>".
- [ ] `sb screen` with no id prints a usage message (consistent with the other
      subcommands).
- [ ] `sb help` lists the `screen` subcommand.

**Out of scope:**

- The board `screen` command / per-line emulator (brief 02), the
  `screen-render` module (brief 01), and the MCP tool (brief 03).
- Any change to other `sb` subcommands.
- A dedicated automated test — this is thin dispatch with no logic, consistent
  with the existing untested `sb` subcommands; it is exercised via the board
  integration test and manual use.

**Depends on:** 02-board-screen-command (consumes the `screen` reply contract)

**Covers:** VC-8

**Runtime:** parallel-safe
