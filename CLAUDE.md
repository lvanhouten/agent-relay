# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev commands

Run server and client in separate terminals from the repo root:

```
npm run server   # starts server on :3001 with --watch (auto-restarts on change)
npm run client   # starts Vite dev server on :5173
```

No build step is needed for development. There is no test suite yet.

## Architecture

This is an npm workspaces monorepo (`server/`, `client/`). The two packages are independent — server is CommonJS, client is ESM.

**Server** (`server/`) — Node.js, Express + `ws` + `node-pty`
- `sessions.js` — `SessionManager` (EventEmitter) owns all PTY processes. Emits `data` and `exit` events consumed by the WS hub. Keeps a capped 1000-chunk scrollback buffer per session.
- `api.js` — Express router mounted at `/api`. REST CRUD over sessions (`GET/POST /sessions`, `GET/DELETE /sessions/:id`).
- `ws.js` — WebSocket hub; each connection attaches to one session by ID parsed from the URL path (`/sessions/:id`). On connect, replays the full scrollback buffer. Handles three inbound message types: `input` (PTY write), `resize` (PTY resize), and outbound `data` / `exit`.
- `index.js` — wires everything together, shares one `http.Server` for both Express and `WebSocketServer`.

**Client** (`client/`) — Vite + React, no router
- Navigation is manual screen state in `App.jsx`: `login` → `sessions` → `terminal`.
- `client/src/api.js` — thin fetch wrappers for the REST API. Paths are relative (`/api/...`) so they hit Vite's dev proxy in dev and the same origin in production.
- `TerminalScreen.jsx` — `useSessionWS` hook manages the WS lifecycle and message parsing. Currently renders ANSI-stripped plain text (xterm.js not yet integrated).
- `SessionsScreen.jsx` — polls `/api/sessions` every 5 s.

**Design system** (`_docs/design-system/`)
- Core UI components live in `_docs/design-system/components/core/` and are imported via the `@ds` Vite alias (e.g. `import { Button } from '@ds/Button.jsx'`). These are plain React + inline styles — no CSS framework.
- Design tokens are CSS custom properties defined in `_docs/design-system/tokens/`. Theming is done by toggling `data-theme="dark|light"` on `<html>` in `App.jsx`.

**Dev proxy** (Vite config)
- `/api/*` → `http://localhost:3001` (REST)
- `/sessions/*` → `ws://localhost:3001` (WebSocket, `ws: true`)

In production the client is served statically by Express (not yet wired up), so the proxy is only needed in dev.

## Open issues

| Issue | File |
|---|---|
| Server accepts all connections regardless of the access token | `_docs/issues/auth-token-not-enforced.md` |
| TerminalScreen strips ANSI and renders plain text instead of a real terminal | `_docs/issues/terminal-missing-xterm.md` |
| App cannot be installed on mobile home screen — no PWA manifest or service worker | `_docs/issues/pwa-manifest-missing.md` |
| Esc and Ctrl+D keyboard shortcuts shown in the UI are not functional | `_docs/issues/keyboard-shortcuts-unimplemented.md` |
