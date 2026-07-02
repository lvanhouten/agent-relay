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
framework; Node's type stripping runs the client's `.test.ts` files directly).
Server tests cover the board kernel, MCP server, and API/session layer; client
tests cover the pure logic modules (`hostTrust.js`, and in `src/core/`:
`wsFrame.ts`, `sessionGuards.ts`) — there's no component-rendering harness, so a
UI-only fix (e.g. a re-entrancy guard in a click handler) is proven by a named
guarded code path instead of a DOM test. `npm run typecheck --workspace=client`
type-checks `src/core/` (the client's TypeScript seam; screens stay JSX).
A regression guard written *after* the code it guards passes trivially — prove it
by mutation before trusting it: break the guarded invariant (delete the
assignment, flip the branch), watch the test fail, revert. One run, and it also
tells you whether the test guards the real invariant or just the line order.

## Architecture

This is an npm workspaces monorepo (`server/`, `client/`). The two packages are independent — server is CommonJS, client is ESM.

**Server** (`server/`) — Node.js, Express + `ws`, backed by a vendored switchboard board (the PTY kernel) under `server/board/`. The web tier holds **no** PTY state; it talks to the board daemon over named pipes.
- `board/` — vendored switchboard kernel. `board.js` is a long-lived daemon ("the board") that owns every PTY ("a line"), keeps a 2000-chunk scrollback per line, broadcasts output to every attached client, and clamps a mirrored line to its smallest client. Control plane `\\.\pipe\agent-relay` — commands `new` / `list` / `join` / `end` / `forget` / `resize` / `shutdown`; one raw data pipe per line (`\\.\pipe\agent-relay.<id>`). A line's exit leaves a **tombstone** in a capped in-memory ring (last 20): `list` replies carry an `ended` array alongside `lines` — `{ id, name, shell, cwd, exitCode, endedAt, reason }`, where `reason` distinguishes `killed` (the `end` command) from `exited` (the process ended on its own) — and `forget` dismisses one. The ring dies with the board process, which is also the id-reuse hygiene (line ids restart per boot). Both planes are gated by a per-boot access secret: a client must send `<secret>\n` as its first line before the board dispatches a command or streams output. The secret is generated at board startup and written to an owner-only file (`%LOCALAPPDATA%\agent-relay\board.<pipe-base>.secret`); `lib.js`'s `connectPipe`/`connectControl` send it transparently, so every client (web, `sb`, `patch`, MCP) is covered without per-caller code. This exists because the OS default pipe DACL grants any local user *read* (verified — write, hence command injection, is default-denied; output disclosure was not), and Node's `net.Server.listen` can't set a restrictive pipe security descriptor. The `new` command accepts a `run` field — an initial command typed into the shell once it's up (the shell stays open). Its own pipe namespace (override with `AGENT_RELAY_PIPE` for an isolated/parallel board), so it never collides with a standalone switchboard. Auto-starts detached on first connect. `lib.js` owns one shared, timed `rpc()` (control request → response, 10s timeout) used identically by `sb.js`, `mcp-server.js`, and `src/board-client.js`, so the framing can't drift between them. Also ships the `sb` CLI for terminal-pane access to the same sessions (`sb new [shell] [--run <cmd>]` spawns a line, runs an optional initial command, and opens a local terminal pane; `sb wait <id>` blocks until it goes quiet or exits — backgroundable via a shell's own job control, e.g. `Bash`'s `run_in_background: true`) and `mcp-server.js`, an MCP server exposing the same lines to an agent as tools (`switchboard_new_line` / `switchboard_list_lines` / `switchboard_read_output` / `switchboard_wait_for_idle` / `switchboard_send_input` / `switchboard_end_line`) — registered globally (`claude mcp add --scope user`) since the pipe namespace isn't repo-scoped, so it's usable from any project on this machine, not just this repo. `switchboard_wait_for_idle` and `sb wait` share one detection implementation in `wait.js`; the MCP tool is only backgroundable if the calling harness can run an arbitrary tool call in the background (Claude Code can't — only `Bash`/`Agent` calls — so use `sb wait` via a background `Bash` call instead of hand-writing a polling script). The MCP server's read-cursor cache is namespaced by the board's boot nonce (`observeBoot`/`endLine` in `mcp-server.js`) so a line id reused after a board restart can't inherit a stale cursor from the previous process.
- `src/board-client.js` — the single seam to the board: re-exports `board/lib.js`'s shared `rpc()` (control RPCs), `board/wait.js`'s `DEFAULT_IDLE_MS` (the canonical quiet threshold), + its own `attach()` (data pipe; scrollback replays on connect). The only place the board's vocabulary is spoken.
- `src/errorHandler.js` — the one Express error-handling middleware, imported by both `index.js` and its own test file so the two can't drift. Logs server-side, returns a generic body — board-unreachable is a 503, anything else a 500, never leaks internals.
- `src/auth.js` — token policy; auth is **on by default**. `AR_TOKEN` pins the token; unset, a per-run token is generated and printed at startup by `index.js`; `AR_NO_AUTH=1` is the explicit dev-only opt-out. Constant-time compare. `resolveToken` is pure over an env object so all three shapes are unit-testable.
- `src/origin.js` — origin policy shared by the REST CORS config (`index.js`) and the WS upgrade gate (`ws.js`): no-Origin (non-browser) passes, loopback and same-origin pass, anything else needs the `AR_CORS_ORIGIN` allowlist. Exists because the operator's browser bridges every page it visits to localhost — and CORS never applied to WebSockets, so the upgrade must enforce it itself.
- `src/sessions.js` — `BoardSessions`: presents the session DTO/surface the API + WS hub consume; every op is an RPC to the board. `spawn` maps the API `command` to the board's `run` (initial command typed into the shell, which stays open) and expands a leading `~` in `cwd`. `list` returns live lines with an **attention state** derived from the board's per-line `idleMs` — `status: 'running'` (output within `wait.js`'s `DEFAULT_IDLE_MS`, the same threshold `sb wait` and `switchboard_wait_for_idle` use, so "idle" has one definition) or `'idle'` (quiet beyond it; deliberately not "done" — PTY bytes can't tell thinking from blocked from finished) — plus the board's tombstones (`status: 'exited'`, with `exitCode`/`reason`); `kill` falls through `end` → `forget`, so DELETE on an exited session dismisses its tombstone (both misses still map to 404). Replaced the old in-process `SessionManager`.
- `src/api.js` — Express router at `/api`. Async REST CRUD (`GET/POST /sessions`, `GET/DELETE /sessions/:id`). POST requires an `application/json` content type (415 otherwise) — a `text/plain` cross-site POST skips the CORS preflight, and an empty parsed body would otherwise spawn a default shell as a side effect.
- `src/ws.js` — WebSocket hub; each connection is origin-gated (`src/origin.js`) then token-gated before it `attach`es to one line by ID from the URL (`/sessions/:id`). Scrollback replays down the data pipe on connect. Inbound `input` / `resize`; outbound `data` / `exit` (the exit frame carries the code parsed from the board's farewell sentinel). An exited session (tombstone) refuses attach with 1008 — its data pipe is gone.
- `index.js` — wires Express + `WebSocketServer` onto one `http.Server`. Port via `PORT` env (default 3017). Closes the listener gracefully on SIGINT/SIGTERM.

> **The board is a separate, long-lived process.** `node --watch` reloads only the web tier (`index.js`, `src/`). Changes under `server/board/` (the kernel `board.js`, the `sb` CLI, `lib.js`) do **not** take effect until the board daemon itself restarts — and restarting it ends every line it owns, including any agent session attached to the board. To test board changes safely, run an isolated board on a separate pipe via `AGENT_RELAY_PIPE` — `server/board/tombstone.e2e.test.js` is the template for making that a permanent integration test instead of a throwaway script (set the env var *before* requiring `lib.js`, spawn `board.js` as a child, poll `list`, clean up pipe + secret file in `t.after`; `node --test` runs each file in its own process, so the override can't leak). **Every RPC in teardown/cleanup code must go through the same namespaced env** — a bare `rpc({cmd:'shutdown'})` with no `AGENT_RELAY_PIPE` hits the production board and ends every live line on it.

**Client** (`client/`) — Vite + React, no router
- Navigation is manual screen state in `App.jsx`: `login` → `sessions` → `terminal`.
- `client/src/core/` — the extracted client core: every piece of debugged, non-obvious client logic, in **TypeScript** (core only — screens stay JSX, the server stays CommonJS-no-build by design; `npm run typecheck --workspace=client` checks `src/core` and nothing else). Imports carry explicit `.ts`/`.tsx` extensions so Node's built-in type stripping can run the core's `.test.ts` files directly under `node --test`.
  - `types.ts` — the contracts at the seam: the session DTO (mirrors `server/src/sessions.js` `toDto()`), the WS frame vocabulary, and `TerminalView`'s mode axis — `interactive` implemented; `spectator` (adopt reported PTY dims + CSS-scale, never send resize) declared for the desktop shell but not built.
  - `api.ts` — thin fetch wrappers for the REST API. Paths are relative (`/api/...`) so they hit Vite's dev proxy in dev and the same origin in production. **Same-origin is the model**: the SPA is served by the relay (or the dev proxy), so every request — the login probe, session CRUD, the WS stream — targets the page's own origin. You reach a relay by loading this page from it (directly or through a tunnel), not by typing a host.
  - `wsFrame.ts` — pure WS-frame guards: `parseFrame` rejects unparseable/non-object frames (a bad frame must never throw inside `onmessage` — that would freeze the terminal with no reconnect), `isValidDataPayload` additionally checks a `'data'` frame's payload is a string before it reaches `term.write()`.
  - `sessionGuards.ts` — the pure halves of the polling guards (`createPollSequence` for stale-poll ordering, `filterKilled` for kill suppression), extracted so they're directly unit-tested instead of proven only as named code paths.
  - `claudeFlags.ts` — pure `--flag value` read/splice helpers (`isClaudeCommand`, `getFlag`, `setFlag`) behind the create dialog's model/effort chips: a chip click edits only its own flag in the command string, so hand-typed text survives. Deliberately shell-naive and never validating — the CLI is the validator.
  - `useSessionWS.ts` — WS lifecycle hook: auto-reconnect with exponential backoff; permanent stop on intentional detach / session `exit` / `1008`. Handlers must be stable refs — the effect intentionally excludes them from deps.
  - `useSessions.ts` — the sessions data layer: list + 5 s poll + create/kill, with the stale-poll sequence guard, the `killed` suppression set (no flicker-back for a poll cycle), and the synchronous re-entrancy refs on create/kill (W2/W4 — a ref check before the first `await`, not just a button's `disabled` prop, which only takes effect after React re-renders). The guards are refs, not state, so they never retrigger effects — port them as-is.
  - `xtermThemes.ts` / `TerminalView.tsx` — the terminal proper: owns xterm (fit addon, Ctrl+D detach via `onDetach`), the mount dance (fit-after-layout + font-load refit, padding on the wrapper not the mount node, reset-before-replay on reconnect, theme sync), and `useSessionWS` behind a refs bridge (the hook's callbacks are stable; the mount effect fills the refs). Exposes `getSelection()` through an imperative handle and reports `ConnStatus` via `onStatusChange` so chrome stays outside.
- `client/src/hostTrust.js` — pure host helpers (`normalizeHost`, `isLocalhost`). `isLocalhost` backs `LoginScreen`'s cleartext gate — the one credential check left in the same-origin model: if the page was loaded over `http://` from a non-localhost host, sending the token means cleartext, so it's gated behind a confirm-and-retry.
- `TerminalScreen.jsx` — thin chrome around `<TerminalView>`: header (status dot fed by `onStatusChange`, copy-selection via the view's handle), footer, back button.
- `SessionsScreen.jsx` — thin composition over `useSessions`: cards (each with its attention state — a pulsing `online` dot + "running" label, or a static `idle` dot labeled "quiet", mapped from the DTO's `running`/`idle` in the card's `ATTENTION` table), filter, a collapsed "Recently exited" section (tombstone cards with a `killed` / `exit N` badge; dismiss reuses `kill`, which the server maps to the board's `forget`), and the new-session dialog (which stays open until a create actually succeeds, so a failure surfaces instead of vanishing into an unhandled rejection). The dialog's claude model/effort chips splice flags via `core/claudeFlags.ts`; last-used values persist to `localStorage` on a successful claude spawn and prefill the next claude command (server-side defaults store deferred to spawn-templates phase 2).

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
| Session cards have no live output preview (the dead placeholder widget was removed; wiring a real one is deferred) | `_docs/issues/2026-07-01-session-card-live-preview.md` |
| Windows secret-file ACL is unverified — `mode` bits are inert on NTFS; the real boundary is the inherited profile ACL (deferred W1) | `_docs/issues/2026-07-01-secret-file-acl-verification.md` |

## Feature backlog (proposed, not started)

One doc per idea under `_docs/issues/`, each with motivation, outline, risks, and the signals that should trigger picking it up. Rough dependency order: tunnel/QR unlocks push, push unlocks notification actions. Session exit metadata (tombstones) landed 2026-07-02 — it unblocked the `exited` attention state and gives scrollback persistence its tombstones. Attention states phase 1 (running/idle/exited on cards) also landed 2026-07-02; the doc stays open for phase 2 (`needs-input` via a Claude Code Notification hook — shared plumbing with hook-driven push).

| Idea | File |
|---|---|
| Hook-driven Web Push when a session needs attention | `_docs/issues/2026-07-02-hook-driven-push-notifications.md` |
| Approve/deny prompts from notification action buttons | `_docs/issues/2026-07-02-notification-action-buttons.md` |
| Attention states phase 2: `needs-input` via hooks (phase 1 landed) | `_docs/issues/2026-07-02-session-attention-states.md` |
| Mobile answer mode: composer bar + canned key chips | `_docs/issues/2026-07-02-mobile-answer-mode.md` |
| Claude-native lines: structured session state from transcripts/hooks | `_docs/issues/2026-07-02-claude-native-lines.md` |
| One-tap spawn templates | `_docs/issues/2026-07-02-fleet-spawn-templates.md` |
| Built-in tunnel + QR pairing | `_docs/issues/2026-07-02-tunnel-qr-pairing.md` |
| Scoped tokens (read-only / per-session input) | `_docs/issues/2026-07-02-scoped-tokens.md` |
| Scrollback persistence: transcripts survive line exit / board restart | `_docs/issues/2026-07-02-scrollback-persistence.md` |
| Terminal QoL: search, transcript download, scroll-to-bottom pill | `_docs/issues/2026-07-02-terminal-qol.md` |
| Desktop workspace shell: two shells over one core, spectator attach, panes, palette | `_docs/issues/2026-07-02-desktop-workspace-shell.md` |
