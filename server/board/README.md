# switchboard

The PTY kernel behind agent-relay. One long-lived daemon — **the board** — owns
every PTY (**a line**). Terminal panes **join** a line for raw I/O, and leave
(just close the pane) without killing the shell. Re-join any time: the line keeps
running on the board, `tmux`-style. Join the same line from two panes and they
mirror each other.

The board outliving its panes is the whole point — start a shell, close the
window, come back to it later exactly where you left off.

Panes open in whatever terminal you ran `sb` from — [WezTerm](https://wezterm.org),
tmux, kitty, and Windows Terminal are auto-detected; anything else works via
`SWITCHBOARD_TERM` (see [Terminals](#terminals)).

> Vendored into agent-relay as its PTY kernel. Uses the `\\.\pipe\agent-relay`
> namespace, so it never collides with a standalone switchboard. The agent-relay
> web server (`server/src/`) joins lines the same way a terminal pane does.

## Vocabulary

| Term | Meaning |
|------|---------|
| the board | the daemon (`board.js`) that owns all PTYs |
| a line | one PTY session (a shell) |
| new | start a new line |
| join | attach a pane (or the web server) to a line — raw I/O relay |
| end | end one line |

## Install

Vendored as part of the agent-relay server — `node-pty` comes from the server
workspace, no separate install. Run the CLI with `node server/board/sb.js <cmd>`
(or `npm link` it to put `sb` on PATH). Pane-opening requires a supported terminal
on PATH (see [Terminals](#terminals)).

## Commands

```
sb up             bring the board online (auto-starts on first use anyway)
sb new [shell]    start a new line + join a tab to it   (e.g. sb new bash)
sb list           list active lines  (ID  PID  SHELL  JOINED  UPTIME)
sb join <id>      join another tab to an existing line
sb end <id>       end one line
sb down           take the board offline (ends every line)
```

`sb new` starts the line in the **current working directory** and opens a tab
joined to it, in the terminal you ran `sb` from. Default shell is `pwsh.exe`
(Windows) / `$SHELL` (otherwise); pass an explicit one as the argument. Close the
tab and the shell lives on; `sb join <id>` brings it back.

### Typical session

```sh
sb new             # a tab opens on a fresh pwsh line in this dir
sb list            # ID  PID    SHELL     JOINED  UPTIME
                   # 1   31012  pwsh.exe  1       12s
# ...close the tab; the shell keeps running...
sb join 1          # join a new tab into line 1, scrollback replayed
sb down            # tear everything down
```

## Terminals

Detection runs **client-side in `sb`** — the board is a detached daemon and can't
see your terminal, so `sb new` / `sb join` capture it and tell the board how to
open the tab. Auto-detected (each opens a tab in your *current* window where the
mux supports it):

| Terminal | How a tab is opened |
|----------|----------------------|
| WezTerm | `wezterm cli spawn` |
| tmux | `tmux new-window` |
| kitty | `kitty @ launch --type=tab` (needs `allow_remote_control`) |
| Windows Terminal | `wt -w 0 new-tab` |

Anything else: set `SWITCHBOARD_TERM` to a launch template containing a `{cmd}`
token —

```sh
export SWITCHBOARD_TERM="alacritty -e {cmd}"   # or: gnome-terminal -- {cmd}
```

On Windows with no match, `wt` is the default. If nothing can be detected the line
is still started — `sb join <id>` a tab into it later from a supported terminal.
Because detection is per-command, `sb join <id>` from a *different* terminal opens
the mirror there, so two different emulators can share one line.

## Autostart

The board [lazy-starts on first use](#how-it-works), so this is optional — it only
keeps a board warm from **logon** (not boot: the shells must live in your
interactive session, not session 0). Two files drive it:

- `start-board.vbs` — launches the board hidden (no console window); finds
  `board.js` next to itself.
- `autostart.ps1` — registers / unregisters a per-user at-logon Task Scheduler
  task that runs the launcher.

```powershell
powershell -ExecutionPolicy Bypass -File autostart.ps1 install     # register + start now
powershell -ExecutionPolicy Bypass -File autostart.ps1 uninstall   # unregister
powershell -ExecutionPolicy Bypass -File autostart.ps1 status      # (default) check
```

`install` also starts the board immediately, so you don't have to re-login. The
task runs as the current user with an interactive logon — no stored password, and
no admin needed for a self-scoped task. `uninstall` only deregisters; a board
already running stays up until `sb down` or reboot.

A warm board at logon holds no lines until you `sb new` — lines don't survive a
board restart — so it's most useful paired with pre-starting your usual lines
headless (no pane), then `sb join`-ing them when you open a terminal.

## How it works

Two planes over Windows named pipes:

- **Control plane** — `\\.\pipe\agent-relay`, newline-delimited JSON
  (`new` / `list` / `join` / `end` / `resize` / `shutdown`). This is the
  "request a line from the board" channel.
- **Data plane** — `\\.\pipe\agent-relay.<id>`, one per line. A *dumb raw byte
  pump*, broadcast to every joined client, with a bounded scrollback buffer
  (last ~2000 chunks) replayed when a client attaches. Keeping it dumb is what
  makes `patch.js` ~40 lines and lets multiple clients share a line.

Pane resize is the one thing that isn't a raw byte, so it rides the control
channel keyed by line id; everything else is verbatim PTY bytes. When a line is
joined from clients of different sizes, the board clamps the PTY to the
**smallest** one (`tmux`-style), so the larger client shows margin rather than a
garbled view.

The board **auto-starts** (detached) the first time any client can't reach it —
the `tmux` "start the server on first use" trick — so you never have to run
`sb up` explicitly.

```
sb new ──▶ board: spawn PTY (a line), open data pipe
                 └─▶ <terminal spawn> -- node patch.js <id>
                          └─▶ pane ⇄ data pipe ⇄ PTY   (raw relay)
```

The agent-relay web server is just another client of this same data pipe: a
browser WebSocket in place of a terminal pane.

## MCP server

`mcp-server.js` exposes the board to Claude Code (or any MCP client) as tools —
`switchboard_new_line`, `switchboard_list_lines`, `switchboard_read_output`,
`switchboard_send_input`, `switchboard_end_line`. This is the same control +
data pipes `sb` uses, but for an agent instead of a human: `sb join` opens a
terminal tab, which is useless to an agent that can't see it, so this attaches
to a line's raw byte stream directly and hands output back as tool-call text —
no pane required. Lines it creates aren't tied to the calling session; a human
can `sb join <id>` a real tab onto one at any time, and an agent can pick a
line back up across a Claude Code restart/compaction by id.

Because the board's pipe namespace (`\\.\pipe\agent-relay`) isn't scoped to
this repo, the server is registered once, globally, and works from any
project directory:

```sh
claude mcp add --scope user switchboard -- node "<repo>\server\board\mcp-server.js"
```

`switchboard_read_output` tracks how much of each line it's already returned
(in-memory, per MCP server process) so repeat reads get only the new output
instead of the board's full replayed scrollback every time. If that new output
is large — a line running for hours, or one this MCP session didn't create —
the response is capped to the last `tailChars` (default 4000) with a note
saying how much was dropped. The cursor still advances past everything seen,
so a dropped middle section can't be recovered later; `full: true` is a
same-read escape hatch for that case, not a default — the tool description
tells the agent to always read the tail first and only re-read with
`full: true` if the truncation note says it actually needs the rest. An agent
reaching for `full: true` on its very first read of a line (e.g. because the
user said "show me the output") is working against the tool, not with it.

`switchboard_wait_for_idle` blocks until a line goes quiet (no new bytes for
`idleMs`, default 12s) or its process exits, whichever comes first, up to
`maxWaitMs` (default 10 minutes) — meant to be called through the calling
agent's own background-task mechanism (e.g. `run_in_background: true`) so the
wait doesn't block a turn; the tool call's own completion is the wake, the same
way a `run_in_background` `Bash`/`Agent` call notifies on completion. It only
tells you *that* something changed (finished a turn, hit a prompt, is waiting
on a decision, or is wedged — a quiet line can't be told apart from any of
those by byte count alone), never *what* — follow up with
`switchboard_read_output` to see what actually happened.

## Files

| file | role |
|------|------|
| `board.js`        | the daemon — owns every line, runs the control + data pipes |
| `patch.js`        | pane-side raw relay (runs inside the terminal pane) |
| `sb.js`           | CLI dispatcher |
| `mcp-server.js`   | MCP server — programmatic (non-pane) access to lines for agents |
| `spawners.js`     | per-terminal pane-launch recipes + client-side detection |
| `lib.js`          | pipe names, detached auto-start, connect-with-retry |
| `start-board.vbs` | launches the board hidden (no console) for autostart |
| `autostart.ps1`   | register / unregister the at-logon autostart task |

## Troubleshooting

- The detached board logs to **`switchboard.log`** next to the source. To watch it
  live instead, run the board in the foreground: `node board.js`.
- "cannot patch into line N" from a pane means the line ended (its shell exited)
  or the board is down — check `sb list`.

## Security

The control and data pipes are unauthenticated: anyone who can open the named pipe
can drive your shells. That's fine for a local single-user box, but don't expose
the pipes across a session boundary or trust them in a multi-user context.
Network exposure + auth is the agent-relay web server's job, not the board's.

## License

MIT
