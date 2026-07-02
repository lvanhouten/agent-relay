# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev commands

Run server and client in separate terminals from the repo root:

```
npm run server   # starts server on :3017 with --watch (auto-restarts on change)
npm run client   # starts Vite dev server on :5173
npm run kill     # free :3017 and :5173 (kill orphaned dev processes)
```

A `predev` guard (`scripts/free-port.js`) frees the port before each `server`/`client`
start, so a restart never hits `EADDRINUSE` from an orphaned process; Vite uses
`strictPort` so it fails loudly rather than drifting off :5173. On Windows, stopping an
`npm run` task often leaves the child `node`/`vite` holding the port — `npm run kill`
(or kill-by-port) is the reliable teardown. The server also closes its listener on
Ctrl+C / SIGTERM (catchable stops only).

No build step is needed for development. Tests: `npm test --workspace=server` /
`npm test --workspace=client` (Node's built-in `node --test` runner, no separate
framework). Server tests cover the board kernel, MCP server, and API/session
layer; client tests cover the pure logic modules (`hostTrust.js`, `wsFrame.js`) —
there's no component-rendering harness, so a UI-only fix (e.g. a re-entrancy
guard in a click handler) is proven by a named guarded code path instead of a
DOM test.

## Architecture

This is an npm workspaces monorepo (`server/`, `client/`). The two packages are independent — server is CommonJS, client is ESM.

**Server** (`server/`) — Node.js, Express + `ws`, backed by a vendored switchboard board (the PTY kernel) under `server/board/`. The web tier holds **no** PTY state; it talks to the board daemon over named pipes.
- `board/` — vendored switchboard kernel. `board.js` is a long-lived daemon ("the board") that owns every PTY ("a line"), keeps a 2000-chunk scrollback per line, broadcasts output to every attached client, and clamps a mirrored line to its smallest client. Control plane `\\.\pipe\agent-relay` — commands `new` / `list` / `join` / `end` / `resize` / `shutdown`; one raw data pipe per line (`\\.\pipe\agent-relay.<id>`). The `new` command accepts a `run` field — an initial command typed into the shell once it's up (the shell stays open). Its own pipe namespace (override with `AGENT_RELAY_PIPE` for an isolated/parallel board), so it never collides with a standalone switchboard. Auto-starts detached on first connect. `lib.js` owns one shared, timed `rpc()` (control request → response, 10s timeout) used identically by `sb.js`, `mcp-server.js`, and `src/board-client.js`, so the framing can't drift between them. Also ships the `sb` CLI for terminal-pane access to the same sessions (`sb new [shell] [--run <cmd>]` spawns a line, runs an optional initial command, and opens a local terminal pane; `sb wait <id>` blocks until it goes quiet or exits — backgroundable via a shell's own job control, e.g. `Bash`'s `run_in_background: true`) and `mcp-server.js`, an MCP server exposing the same lines to an agent as tools (`switchboard_new_line` / `switchboard_list_lines` / `switchboard_read_output` / `switchboard_wait_for_idle` / `switchboard_send_input` / `switchboard_end_line`) — registered globally (`claude mcp add --scope user`) since the pipe namespace isn't repo-scoped, so it's usable from any project on this machine, not just this repo. `switchboard_wait_for_idle` and `sb wait` share one detection implementation in `wait.js`; the MCP tool is only backgroundable if the calling harness can run an arbitrary tool call in the background (Claude Code can't — only `Bash`/`Agent` calls — so use `sb wait` via a background `Bash` call instead of hand-writing a polling script). The MCP server's read-cursor cache is namespaced by the board's boot nonce (`observeBoot`/`endLine` in `mcp-server.js`) so a line id reused after a board restart can't inherit a stale cursor from the previous process.
- `src/board-client.js` — the single seam to the board: re-exports `board/lib.js`'s shared `rpc()` (control RPCs) + its own `attach()` (data pipe; scrollback replays on connect). The only place the board's vocabulary is spoken.
- `src/errorHandler.js` — the one Express error-handling middleware, imported by both `index.js` and its own test file so the two can't drift. Logs server-side, returns a generic body — board-unreachable is a 503, anything else a 500, never leaks internals.
- `src/sessions.js` — `BoardSessions`: presents the session DTO/surface the API + WS hub consume; every op is an RPC to the board. `spawn` maps the API `command` to the board's `run` (initial command typed into the shell, which stays open) and expands a leading `~` in `cwd`. Replaced the old in-process `SessionManager`.
- `src/api.js` — Express router at `/api`. Async REST CRUD (`GET/POST /sessions`, `GET/DELETE /sessions/:id`).
- `src/ws.js` — WebSocket hub; each connection `attach`es to one line by ID from the URL (`/sessions/:id`). Scrollback replays down the data pipe on connect. Inbound `input` / `resize`; outbound `data` / `exit`.
- `index.js` — wires Express + `WebSocketServer` onto one `http.Server`. Port via `PORT` env (default 3017). Closes the listener gracefully on SIGINT/SIGTERM.

> **The board is a separate, long-lived process.** `node --watch` reloads only the web tier (`index.js`, `src/`). Changes under `server/board/` (the kernel `board.js`, the `sb` CLI, `lib.js`) do **not** take effect until the board daemon itself restarts — and restarting it ends every line it owns, including any agent session attached to the board. To test board changes safely, run an isolated board on a separate pipe via `AGENT_RELAY_PIPE`.

**Client** (`client/`) — Vite + React, no router
- Navigation is manual screen state in `App.jsx`: `login` → `sessions` → `terminal`.
- `client/src/api.js` — thin fetch wrappers for the REST API. Paths are relative (`/api/...`) so they hit Vite's dev proxy in dev and the same origin in production.
- `client/src/hostTrust.js` — pure host-normalization/trust helpers (`normalizeHost`, `isLocalhost`) used by `LoginScreen` before the token is ever sent: prepends `http://` to a scheme-less `host:port`, warns before sending the token to a host that isn't localhost and hasn't been connected to successfully before.
- `client/src/wsFrame.js` — pure WS-frame guards used by `TerminalScreen`: `parseFrame` rejects unparseable/non-object frames (a bad frame must never throw inside `onmessage` — that would freeze the terminal with no reconnect), `isValidDataPayload` additionally checks a `'data'` frame's payload is a string before it reaches `term.write()`.
- `TerminalScreen.jsx` — `useSessionWS` hook manages the WS lifecycle with auto-reconnect (exponential backoff; stops on intentional detach / session `exit` / `1008`; resets and repaints the terminal on reconnect so the scrollback replay doesn't duplicate). Renders a real terminal via xterm.js (fit addon, theming, Ctrl+D to detach).
- `SessionsScreen.jsx` — polls `/api/sessions` every 5 s. `handleCreate`/`handleKill` each guard against a fast double-click firing two concurrent requests (a synchronous ref check before the first `await`, not just the button's `disabled` prop, which only takes effect after React re-renders).

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
| Session cards have no live output preview (the dead placeholder widget was removed; wiring a real one is deferred) | `_docs/issues/2026-07-01-session-card-live-preview.md` |
| "Relay host" field only governs the initial login probe — all other traffic is same-origin | `_docs/issues/2026-07-01-relay-host-only-governs-login.md` |
| Board named pipes have no verified/explicit DACL restriction | `_docs/issues/2026-07-01-named-pipe-dacl-verification.md` |
| Root and vendored-board `autostart.ps1` scripts are near-identical duplicates | `_docs/issues/2026-07-01-duplicated-autostart-scripts.md` |
| `switchboard_send_input` has no bracketed-paste framing — a multi-line value auto-submits each line | `_docs/issues/2026-07-01-send-input-bracketed-paste.md` |
| Initial `run`-command feed has no delivery confirmation (a slow-starting shell can silently eat it) | `_docs/issues/2026-07-01-run-feed-delivery-confirmation.md` |
