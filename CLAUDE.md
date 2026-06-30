# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev commands

Run server and client in separate terminals from the repo root:

```
npm run server   # starts server on :3017 with --watch (auto-restarts on change)
npm run client   # starts Vite dev server on :5173
```

No build step is needed for development. There is no test suite yet.

## Architecture

This is an npm workspaces monorepo (`server/`, `client/`). The two packages are independent — server is CommonJS, client is ESM.

**Server** (`server/`) — Node.js, Express + `ws`, backed by a vendored switchboard board (the PTY kernel) under `server/board/`. The web tier holds **no** PTY state; it talks to the board daemon over named pipes.
- `board/` — vendored switchboard kernel. `board.js` is a long-lived daemon ("the board") that owns every PTY ("a line"), keeps a 2000-chunk scrollback per line, broadcasts output to every attached client, and clamps a mirrored line to its smallest client. Control plane `\\.\pipe\agent-relay` — commands `new` / `list` / `join` / `end` / `resize` / `shutdown`; one raw data pipe per line (`\\.\pipe\agent-relay.<id>`). Its own pipe namespace, so it never collides with a standalone switchboard. Auto-starts detached on first connect. Also ships the `sb` CLI for terminal-pane access to the same sessions.
- `src/board-client.js` — the single seam to the board: `rpc()` (control RPCs) + `attach()` (data pipe; scrollback replays on connect). The only place the board's vocabulary is spoken.
- `src/sessions.js` — `BoardSessions`: presents the session DTO/surface the API + WS hub consume; every op is an RPC to the board. Replaced the old in-process `SessionManager`.
- `src/api.js` — Express router at `/api`. Async REST CRUD (`GET/POST /sessions`, `GET/DELETE /sessions/:id`).
- `src/ws.js` — WebSocket hub; each connection `attach`es to one line by ID from the URL (`/sessions/:id`). Scrollback replays down the data pipe on connect. Inbound `input` / `resize`; outbound `data` / `exit`.
- `index.js` — wires Express + `WebSocketServer` onto one `http.Server`. Port via `PORT` env (default 3017).

**Client** (`client/`) — Vite + React, no router
- Navigation is manual screen state in `App.jsx`: `login` → `sessions` → `terminal`.
- `client/src/api.js` — thin fetch wrappers for the REST API. Paths are relative (`/api/...`) so they hit Vite's dev proxy in dev and the same origin in production.
- `TerminalScreen.jsx` — `useSessionWS` hook manages the WS lifecycle; renders a real terminal via xterm.js (fit addon, theming, Ctrl+D to detach).
- `SessionsScreen.jsx` — polls `/api/sessions` every 5 s.

**Design system** (`_docs/design-system/`)
- Core UI components live in `_docs/design-system/components/core/` and are imported via the `@ds` Vite alias (e.g. `import { Button } from '@ds/Button.jsx'`). These are plain React + inline styles — no CSS framework.
- Design tokens are CSS custom properties defined in `_docs/design-system/tokens/`. Theming is done by toggling `data-theme="dark|light"` on `<html>` in `App.jsx`.

**Dev proxy** (Vite config)
- `/api/*` → `http://localhost:3017` (REST)
- `/sessions/*` → `ws://localhost:3017` (WebSocket, `ws: true`)

In production the client is served statically by Express (not yet wired up), so the proxy is only needed in dev.

## Open issues

| Issue | File |
|---|---|
| Server accepts all connections regardless of the access token | `_docs/issues/auth-token-not-enforced.md` |
| App cannot be installed on mobile home screen — no PWA manifest or service worker | `_docs/issues/pwa-manifest-missing.md` |
| Esc and Ctrl+D keyboard shortcuts shown in the UI are not functional | `_docs/issues/keyboard-shortcuts-unimplemented.md` |
