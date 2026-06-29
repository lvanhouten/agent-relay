# agent-relay

A self-hosted bridge that lets you interact with running AI agent sessions (Claude Code, etc.) from any browser — desktop, tablet, or phone.

Run your agents on a powerful machine. Connect to them from anywhere.

## Concept

When working with AI coding agents, you often want to:
- Start a long-running session on your PC and check in on it from your phone
- Manage multiple concurrent agent sessions from a single UI
- Hand off between devices without losing context

`agent-relay` solves this by running a lightweight server on your machine that manages agent processes and exposes them over a WebSocket API. Any browser can connect to the relay and interact with sessions in real time.

## Architecture

```
Browser (any device)              Relay Server (your PC)
┌──────────────────────┐          ┌──────────────────────────────────┐
│                      │          │                                  │
│   Session List       │          │   Session Manager                │
│   ┌──────────────┐   │          │   ┌──────────┐  ┌──────────┐    │
│   │  Session A   │   │  REST    │   │  PTY 1   │  │  PTY 2   │    │
│   │  Session B   │   │ ──────→  │   │  claude  │  │  claude  │    │
│   │  Session C   │   │          │   └──────────┘  └──────────┘    │
│   └──────────────┘   │          │                                  │
│                      │          │   Scrollback Buffers             │
│   [select session]   │          │   Session Metadata               │
│                      │  WS      │                                  │
│   Terminal View      │ ←──────→ │   WebSocket Hub                  │
│   ┌──────────────┐   │          │                                  │
│   │              │   │          └──────────────────────────────────┘
│   │  xterm.js    │   │
│   │              │   │
│   └──────────────┘   │
└──────────────────────┘
```

## Features

- **Session list** — see all running agent processes at a glance, with name, status, and last activity
- **Spawn & kill** — create new agent sessions or terminate them from the UI
- **Live terminal** — full PTY passthrough via xterm.js, handles escape codes, prompts, and interactive input correctly
- **Scrollback** — reconnect to a session and see what happened while you were away
- **Multi-client** — multiple browsers can observe the same session simultaneously
- **Model agnostic** — works with any CLI-based agent (Claude Code, Codex CLI, Gemini CLI, custom scripts)

## Stack

**Server**
- Node.js
- `node-pty` — spawns agent processes in a real pseudo-terminal
- `express` — REST API for session management
- `ws` — WebSocket server for real-time PTY I/O

**Client**
- React
- `xterm.js` — terminal emulator in the browser
- PWA-ready — installable on mobile home screen

**Networking**
- Designed to run on localhost, exposed remotely via [Tailscale](https://tailscale.com/) (recommended) or any tunnel (ngrok, Cloudflare Tunnel, etc.)

## API

```
GET    /sessions           List all sessions
POST   /sessions           Spawn a new session
DELETE /sessions/:id       Kill a session

WS     /sessions/:id       Bidirectional PTY stream (stdin/stdout)
```

## Roadmap

- [ ] Backend: session manager with node-pty
- [ ] Backend: REST + WebSocket server
- [ ] Frontend: session list UI
- [ ] Frontend: xterm.js terminal view
- [ ] Frontend: PWA manifest + mobile polish
- [ ] Auth: simple token-based auth for the relay endpoint
- [ ] Notifications: push alerts when a session needs input
- [ ] Themes: match your terminal color scheme
