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
- **Login safety** — warns before sending your token to a host you haven't successfully connected to before, or over a non-HTTPS connection to a non-localhost host

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
collide with an orphaned process. Without `AR_TOKEN` set, the server prints a
generated access token at startup — paste it into the login screen.

```sh
npm test --workspace=server   # board kernel, MCP server, API/session layer
npm test --workspace=client   # pure logic modules (host trust, WS-frame guards)
```

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

**From your phone** — on an unfiltered network, expose the relay via the built-in
tunnel (`AR_TUNNEL=tailscale`) and pair a device with the QR in the dashboard. On
a network that DNS-filters Tailscale (e.g. a locked-down office), reach the relay
over the Microsoft Remote Desktop app instead — see the phone-shaped RDP recipe in
[`_docs/rdp-mobile-recipe.md`](_docs/rdp-mobile-recipe.md).

## API

```
GET    /api/sessions           List all sessions
POST   /api/sessions           Spawn a new session
                               body { name, cwd, shell, command }
                               command runs in the shell on launch (shell stays open)
GET    /api/sessions/:id       Get one session
DELETE /api/sessions/:id       Kill a session

POST   /api/notify             Push a notification + optionally flag a session
                               body { title, body, url?, priority?, sessionId?, cwd?, needsInput? }
                               fans out to configured push sinks (Pushover);
                               needsInput + sessionId (or cwd) lights that card's
                               "needs input" state

WS     /sessions/:id           Bidirectional PTY stream
                               (in: input / resize · out: data / exit)
```

Auth is **on by default**: REST requires `Authorization: Bearer <token>`, the WS
a `?token=`. `AR_TOKEN` pins the token; unset, the server generates one per run
and prints it at startup — paste it into the login screen. `AR_NO_AUTH=1`
disables auth (dev only: listening on localhost is not a boundary by itself —
any page the operator's browser visits can reach `localhost:3017`).

Cross-origin requests are denied by default except from loopback origins (the
Vite dev client) and same-origin pages; set `AR_CORS_ORIGIN` (comma-separated
full origins) to extend the allowlist. The WS upgrade enforces the same origin
policy (CORS never applied to WebSockets), and `POST /api/sessions` requires an
`application/json` content type so a preflight-exempt "simple" cross-site POST
can't spawn a session.

## Notifications

The relay is pull-only, so a session can sit blocked on a prompt while your phone
is locked. `POST /api/notify` pushes an alert to your phone **and** lights the
session's card with a pulsing "needs input" state so the dashboard answers "which
session needs me?" at a glance.

Delivery is [Pushover](https://pushover.net): the relay makes one outbound HTTPS
POST and Pushover's own app renders the notification — no VAPID, no service
worker, no secure origin, no tunnel. (It also survives networks that DNS-filter
Tailscale.) Enable it with two env vars; leave them unset and the endpoint still
flags the card but sends no push (feature simply off):

```
AR_PUSHOVER_TOKEN=<your Pushover application API token>
AR_PUSHOVER_USER=<your Pushover user key>
```

> Payload discipline: `title`/`body` transit Pushover's servers. Keep them to
> "session `<name>` needs attention" — **never** session output, which can carry
> secrets or PHI given what runs in these shells.

`priority` maps to Pushover's: `1` bypasses quiet hours, `2` repeats until you
acknowledge (retry/expire are supplied automatically). `url` deep-links on tap.

### Claude Code hook recipe

Fire the alert from a Claude Code **Notification** hook (Claude is blocked asking
for input/permission). Add to the project's `.claude/settings.json` — `$AR_TOKEN`
and the relay URL come from the environment the agent runs in. To light the
*specific* card that needs you (not just buzz the phone), name the session:
the relay injects `$AGENT_RELAY_SESSION` (the board line id) into every session
it spawns, so a hook can send it back verbatim, with `cwd` as a fallback for
lines spawned outside the relay:

```json
{
  "hooks": {
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://localhost:3017/api/notify -H \"Authorization: Bearer $AR_TOKEN\" -H 'Content-Type: application/json' -d \"{\\\"title\\\":\\\"Claude needs input\\\",\\\"body\\\":\\\"A session is waiting on you\\\",\\\"needsInput\\\":true,\\\"priority\\\":1,\\\"sessionId\\\":\\\"$AGENT_RELAY_SESSION\\\",\\\"cwd\\\":\\\"$CLAUDE_PROJECT_DIR\\\"}\""
          }
        ]
      }
    ]
  }
}
```

`sessionId` wins when present; otherwise the relay matches `cwd` against its live
lines (on a same-directory tie, the most recently active line is flagged). A
line spawned outside the relay (`sb`, or a shell you opened yourself) has no
`$AGENT_RELAY_SESSION` — it expands to empty and the `cwd` match takes over.

Add a `Stop` hook the same way (drop `needsInput`) if you also want a "session
finished" ping. The needs-input flag clears itself on the session's next input
or output.

## Roadmap

- [x] Backend: PTY session kernel (switchboard board) over node-pty
- [x] Backend: REST + WebSocket server
- [x] Frontend: session list UI
- [x] Frontend: xterm.js terminal view
- [x] Themes: light / dark terminal
- [x] Frontend: PWA manifest + service worker (installable on mobile)
- [x] Auth: opt-in bearer-token auth (`AR_TOKEN`)
- [x] Auth: secure defaults — token required (auto-generated), WS `Origin` check, CORS allowlist
- [ ] Frontend: mobile polish
- [x] Notifications: push alerts when a session needs input (Pushover + `needs-input` cards)
