# agent-relay

A self-hosted bridge that lets you interact with running AI agent sessions (Claude Code, etc.) from any browser — desktop, tablet, or phone.

Run your agents on a powerful machine. Connect to them from anywhere.

## Concept

When working with AI coding agents, you often want to:
- Start a long-running session on your PC and check in on it from your phone
- Manage multiple concurrent agent sessions from a single UI
- Hand off between devices without losing context

`agent-relay` solves this by running a lightweight server on your machine that exposes a long-lived PTY kernel over a REST + WebSocket API. Any browser can connect to the relay and interact with sessions in real time — and so can the `sb` terminal CLI, against the same sessions.

## Architecture

The web server holds **no** PTY state. It's a stateless relay in front of a
long-lived **board** (the vendored [switchboard](server/board/README.md) kernel)
that actually owns the PTYs. The board outlives the relay — restart the server
without dropping a session — and the `sb` CLI can join the same lines from a
terminal pane.

```
Browser (any device)          Relay server :3017            Board kernel (daemon)
┌────────────────────┐        ┌────────────────────┐        ┌──────────────────────┐
│  Session list      │  REST  │  Express  /api     │  pipe  │  the board           │
│  Terminal (xterm)  │ <────> │  WS hub  /sessions │ <────> │  lines (PTYs)        │
│                    │   WS   │  (no PTY state)    │        │  scrollback + sizes  │
└────────────────────┘        └────────────────────┘        └──────────────────────┘
     phone / laptop                stateless relay            outlives the relay;
                                                              shared with the `sb` CLI
```

## Features

- **Session list** — see all running agent processes at a glance, with name, status, and last activity
- **Spawn & kill** — create new agent sessions or terminate them from the UI; give a session a command to run on launch (e.g. `claude`, `npm run dev`) — it's typed into the shell, which stays open when the command exits
- **Live terminal** — full PTY passthrough via xterm.js, handles escape codes, prompts, and interactive input correctly
- **Scrollback & auto-reconnect** — reconnect to a session and see what happened while you were away; the terminal auto-reconnects after a network blip or server restart and repaints current state
- **Multi-client** — multiple browsers (and terminal panes) can observe the same session simultaneously
- **Crash-safe** — sessions live in the board daemon, so the web server can restart without losing them
- **Model agnostic** — works with any CLI-based agent (Claude Code, Codex CLI, Gemini CLI, custom scripts)

## Stack

**Server** (`:3017`)
- `express` — REST for session CRUD (`/api/sessions`)
- `ws` — WebSocket for real-time PTY I/O (`/sessions/:id`)
- **switchboard board** — vendored PTY kernel in `server/board/`: a long-lived daemon that owns the PTYs ("lines"), keeps per-line scrollback, broadcasts to every attached client, and clamps a mirrored line to its smallest client. `node-pty` lives in the kernel; the web tier never touches it directly.

**Client**
- React
- `xterm.js` — terminal emulator in the browser
- PWA-ready — installable on mobile home screen

**Networking**
- Designed to run on localhost (`:3017` by default), exposed remotely via [Tailscale](https://tailscale.com/) (recommended) or any tunnel (ngrok, Cloudflare Tunnel, etc.)

## Running

```sh
npm install                 # install workspaces
npm run server              # API + WS on :3017  (set PORT to override)
npm run client              # Vite dev server on :5173 (proxies to :3017)
npm run kill                # free :3017 and :5173 (stop orphaned dev processes)
```

A `predev` guard frees the port before `server`/`client` start, so a restart can't
collide with an orphaned process.

The board kernel auto-starts on the server's first request and outlives it. For
terminal access to the same sessions, use the bundled `sb` CLI — e.g.
`node server/board/sb.js list`, or `node server/board/sb.js new --run claude` to
spawn a session that runs `claude` and open a local terminal pane (see
[server/board/README.md](server/board/README.md)).

**Autostart at login** (Windows) — `autostart.ps1` registers a per-user logon task
that launches the server hidden via `start-relay.vbs`:

```powershell
powershell -ExecutionPolicy Bypass -File autostart.ps1 install     # register + start now
powershell -ExecutionPolicy Bypass -File autostart.ps1 uninstall   # unregister
powershell -ExecutionPolicy Bypass -File autostart.ps1 status      # (default) check
```

## API

```
GET    /api/sessions           List all sessions
POST   /api/sessions           Spawn a new session
                               body { name, cwd, shell, command }
                               command runs in the shell on launch (shell stays open)
GET    /api/sessions/:id       Get one session
DELETE /api/sessions/:id       Kill a session

WS     /sessions/:id           Bidirectional PTY stream
                               (in: input / resize · out: data / exit)
```

Set `AR_TOKEN` to require a bearer token on REST and a `?token=` on the WS.

## Roadmap

- [x] Backend: PTY session kernel (switchboard board) over node-pty
- [x] Backend: REST + WebSocket server
- [x] Frontend: session list UI
- [x] Frontend: xterm.js terminal view
- [x] Themes: light / dark terminal
- [ ] Frontend: PWA manifest + mobile polish
- [ ] Auth: enforce token-based auth on the relay endpoint
- [ ] Notifications: push alerts when a session needs input
