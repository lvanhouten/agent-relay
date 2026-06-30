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
sb new [shell]    start a new line + join a pane to it   (e.g. sb new bash)
sb list           list active lines  (ID  PID  SHELL  JOINED  UPTIME)
sb join <id>      join another pane to an existing line
sb end <id>       end one line
sb down           take the board offline (ends every line)
```

`sb new` starts the line in the **current working directory** and opens a pane
joined to it, in the terminal you ran `sb` from. Default shell is `pwsh.exe`
(Windows) / `$SHELL` (otherwise); pass an explicit one as the argument. Close the
pane and the shell lives on; `sb join <id>` brings it back.

### Typical session

```sh
sb new             # a pane opens on a fresh pwsh line in this dir
sb list            # ID  PID    SHELL     JOINED  UPTIME
                   # 1   31012  pwsh.exe  1       12s
# ...close the pane; the shell keeps running...
sb join 1          # join a new pane into line 1, scrollback replayed
sb down            # tear everything down
```

## Terminals

Detection runs **client-side in `sb`** — the board is a detached daemon and can't
see your terminal, so `sb new` / `sb join` capture it and tell the board how to
open the pane. Auto-detected (each opens a pane in your *current* window where the
mux supports it):

| Terminal | How a pane is opened |
|----------|----------------------|
| WezTerm | `wezterm cli spawn` |
| tmux | `tmux split-window` |
| kitty | `kitty @ launch` (needs `allow_remote_control`) |
| Windows Terminal | `wt -w 0 split-pane` |

Anything else: set `SWITCHBOARD_TERM` to a launch template containing a `{cmd}`
token —

```sh
export SWITCHBOARD_TERM="alacritty -e {cmd}"   # or: gnome-terminal -- {cmd}
```

On Windows with no match, `wt` is the default. If nothing can be detected the line
is still started — `sb join <id>` a pane into it later from a supported terminal.
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

## Files

| file | role |
|------|------|
| `board.js`        | the daemon — owns every line, runs the control + data pipes |
| `patch.js`        | pane-side raw relay (runs inside the terminal pane) |
| `sb.js`           | CLI dispatcher |
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
