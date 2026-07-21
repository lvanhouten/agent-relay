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

### Process teardown & session cleanliness (Windows)

`npm run kill` only frees the two **TCP ports** (:3017 server, :5173 Vite) via
`scripts/free-port.js`. It does **not** touch the **board daemon** (it lives on named
pipes, `\\.\pipe\agent-relay`, not a port — kill-by-port never sees it) or the orphaned
**`mcp-server.js`** instances (one is spawned per Claude Code session; they accumulate —
a dozen-plus after a week of sessions is normal, harmless but noisy). These pile up
across restarts, so periodically enumerate and prune.

Process families, via `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` then a
`CommandLine` filter:

| CommandLine match | What it is |
|---|---|
| `node --watch index.js` | server watch wrapper — forks the real server |
| `node index.js` (agent-relay path, no `--watch`) | the actual running server (child of the wrapper) |
| `vite/bin/vite.js` | Vite dev server |
| `board.js` | the board daemon — **one**, detached, outlives whoever started it |
| `mcp-server.js` | a per-session MCP server — **many**, stale, safe to kill |

Bulk-prune orphaned dev processes (board, watch wrapper, Vite, stale MCP servers) by
CommandLine match — note `-match` uses regex, so escape `.`:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'board\.js|--watch index\.js|agent-relay.*vite|mcp-server\.js' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
```

**Restarting the board.** The board is a detached daemon and restarting it ends every
line it owns (including any live agent session) — so this is deliberate, not routine.
Kill its `board.js` process (or send `shutdown` over the control pipe). It re-spawns
automatically on the next **autostart-enabled** connect — a real web session op
(`BoardSessions` create/list) or `switchboard_new_line` — but **not** on
`switchboard_list_lines`, which passes `autostart: false`. To force a fresh board without
creating a line, start it directly: `node server/board/board.js` (detached).

**Liveness gotcha — an empty `list` does NOT prove a live board.**
`switchboard_list_lines` both disables autostart *and* swallows an unreachable-board
error as `{ lines: [] }` (`.catch(() => ({ lines: [] }))` in `mcp-server.js`), so a `[]`
reply is ambiguous: empty board *or* no board at all. To confirm a board is actually
running, check one of the unambiguous signals instead:
- the **secret-file mtime** — `%LOCALAPPDATA%\agent-relay\board.agent-relay.secret` is
  rewritten on every board boot, so a just-updated timestamp proves a fresh start; or
- the **`board.js` process** itself (see the table above).

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
- `board/` — vendored switchboard kernel. `board.js` is a long-lived daemon ("the board") that owns every PTY ("a line"), keeps a 2000-chunk scrollback per line, broadcasts output to every attached client, and clamps a mirrored line to its smallest client. On attach a client receives its history as a **reconstructed replay**, not the raw byte-log: the log is run through a transient `@xterm/headless` + `SerializeAddon` emulator sized to the capture width and the serialized (flat, colored) buffer is sent, so a joiner at a different width re-wraps it clean instead of garbling on cursor-relative redraws (the `sb join` scroll-garble — `adr/0004`, `attachWithReplay` in `board.js` / `reconstructReplay` in `screen-render.js`). It's a throwaway emulator per attach, distinct from the lazy per-line screen emulator of `adr/0002`; live output produced mid-reconstruction is queued and flushed behind the replay so ordering holds. Control plane `\\.\pipe\agent-relay` — commands `new` / `list` / `join` / `end` / `forget` / `resize` / `screen` / `shutdown`; one raw data pipe per line (`\\.\pipe\agent-relay.<id>`). A line's exit leaves a **tombstone** in a capped in-memory ring (last 20): `list` replies carry an `ended` array alongside `lines` — `{ id, name, shell, cwd, exitCode, endedAt, reason }`, where `reason` distinguishes `killed` (the `end` command) from `exited` (the process ended on its own) — and `forget` dismisses one. The ring dies with the board process, which is also the id-reuse hygiene (line ids restart per boot). Both planes are gated by a per-boot access secret: a client must send `<secret>\n` as its first line before the board dispatches a command or streams output. The secret is generated at board startup and written to an owner-only file (`%LOCALAPPDATA%\agent-relay\board.<pipe-base>.secret`); `lib.js`'s `connectPipe`/`connectControl` send it transparently, so every client (web, `sb`, `patch`, MCP) is covered without per-caller code. This exists because the OS default pipe DACL grants any local user *read* (verified — write, hence command injection, is default-denied; output disclosure was not), and Node's `net.Server.listen` can't set a restrictive pipe security descriptor. The `new` command accepts a `run` field — an initial command typed into the shell once it's up (the shell stays open). The `screen` command (`{ cmd:'screen', id }`) returns a line's **rendered screen** — the current terminal grid from a per-line headless VT emulator (`@xterm/headless`, lazy-initialized on first read, seeded from scrollback then fed live, disposed on exit): live → `{ ok:true, boot, grid, cursor:{row,col}, cols, rows }`, an exited line → `{ ok:false, ended:true, exitCode, reason }`, a never-existed id → `{ ok:false, ended:false }` (distinguish the two misses by `ended`, not by both being falsy). It's a stateless snapshot each call — no read cursor, unlike `read_output` — and complements the raw stream/transcript, never replaces them (see `adr/0002-board-owned-rendered-screen.md` + CONTEXT.md *rendered screen*). Its own pipe namespace (override with `AGENT_RELAY_PIPE` for an isolated/parallel board), so it never collides with a standalone switchboard. Auto-starts detached on first connect. `lib.js` owns one shared, timed `rpc()` (control request → response, 10s timeout) used identically by `sb.js`, `mcp-server.js`, and `src/board-client.js`, so the framing can't drift between them. Also ships the `sb` CLI for terminal-pane access to the same sessions (`sb new [shell] [--run <cmd>]` spawns a line, runs an optional initial command, and opens a local terminal pane; `sb wait <id>` blocks until it goes quiet or exits — backgroundable via a shell's own job control, e.g. `Bash`'s `run_in_background: true`; `sb screen <id>` prints the line's current rendered grid) and `mcp-server.js`, an MCP server exposing the same lines to an agent as tools (`switchboard_new_line` / `switchboard_list_lines` / `switchboard_read_output` / `switchboard_read_screen` / `switchboard_send_input` / `switchboard_end_line`) — registered globally (`claude mcp add --scope user`) since the pipe namespace isn't repo-scoped, so it's usable from any project on this machine, not just this repo. There is deliberately no MCP wait tool (the old `switchboard_wait_for_idle` was removed 2026-07-07): Claude Code can't background a bare MCP tool call — only `Bash`/`Agent` calls — so it just wedged the calling turn; the wait entry point is `sb wait` via a background `Bash` call, whose detection lives in `wait.js`. The MCP server's read-cursor cache is namespaced by the board's boot nonce (`observeBoot`/`endLine` in `mcp-server.js`) so a line id reused after a board restart can't inherit a stale cursor from the previous process.
- `src/board-client.js` — the single seam to the board: re-exports `board/lib.js`'s shared `rpc()` (control RPCs), `board/wait.js`'s `DEFAULT_IDLE_MS` (the canonical quiet threshold), + its own `attach()` (data pipe; the reconstructed-replay history streams on connect — see the board section). The only place the board's vocabulary is spoken.
- `src/errorHandler.js` — the one Express error-handling middleware, imported by both `index.js` and its own test file so the two can't drift. Logs server-side, returns a generic body — board-unreachable is a 503, anything else a 500, never leaks internals.
- `src/auth.js` — token policy; auth is **on by default**. `AR_TOKEN` pins the token; unset, a per-run token is generated and printed at startup by `index.js`; `AR_NO_AUTH=1` is the explicit dev-only opt-out. Constant-time compare. `resolveToken` is pure over an env object so all three shapes are unit-testable.
- `src/origin.js` — origin policy shared by the REST CORS config (`index.js`) and the WS upgrade gate (`ws.js`): no-Origin (non-browser) passes, loopback and same-origin pass, anything else needs the `AR_CORS_ORIGIN` allowlist. Exists because the operator's browser bridges every page it visits to localhost — and CORS never applied to WebSockets, so the upgrade must enforce it itself.
- `src/sessions.js` — `BoardSessions`: presents the session DTO/surface the API + WS hub consume; every op is an RPC to the board. `spawn` maps the API `command` to the board's `run` (initial command typed into the shell, which stays open) and expands a leading `~` in `cwd`. `list` returns live lines with an **attention state** derived from the board's per-line `idleMs` — `status: 'running'` (output within `wait.js`'s `DEFAULT_IDLE_MS`, the same threshold `sb wait` uses, so "idle" has one definition) or `'idle'` (quiet beyond it; deliberately not "done" — PTY bytes can't tell thinking from blocked from finished) — plus the board's tombstones (`status: 'exited'`, with `exitCode`/`reason`); `kill` falls through `end` → `forget`, so DELETE on an exited session dismisses its tombstone (both misses still map to 404). Replaced the old in-process `SessionManager`.
- `src/api.js` — Express router at `/api`. Async REST CRUD (`GET/POST /sessions`, `GET/DELETE /sessions/:id`). POST requires an `application/json` content type (415 otherwise) — a `text/plain` cross-site POST skips the CORS preflight, and an empty parsed body would otherwise spawn a default shell as a side effect.
- `src/static.js` — serves the built client (`client/dist`) from the same port as the API, when a build exists (`npm run build`, root script). Deliberately unauthenticated (the login page must load before there's a token — the token gates `/api` and the WS attach, not the page). Hashed `assets/` get immutable cache headers; `index.html` is `no-cache`. SPA fallback serves `index.html` for unknown GETs but never shadows `/api` or `/sessions`. No build → returns `null` and `index.js` skips the mount (dev mode, where Vite owns the page).
- `src/ws.js` — WebSocket hub; each connection is origin-gated (`src/origin.js`) then token-gated before it `attach`es to one line by ID from the URL (`/sessions/:id`). Scrollback replays down the data pipe on connect. Inbound `input` / `resize`; outbound `data` / `exit` (the exit frame carries the code parsed from the board's farewell sentinel). An exited session (tombstone) refuses attach with 1008 — its data pipe is gone.
- `index.js` — wires Express + `WebSocketServer` onto one `http.Server`. Port via `PORT` env (default 3017). Closes the listener gracefully on SIGINT/SIGTERM.

> **The board is a separate, long-lived process.** `node --watch` reloads only the web tier (`index.js`, `src/`). Changes under `server/board/` (the kernel `board.js`, the `sb` CLI, `lib.js`) do **not** take effect until the board daemon itself restarts — and restarting it ends every line it owns, including any agent session attached to the board. To test board changes safely, run an isolated board on a separate pipe via `AGENT_RELAY_PIPE` — `server/board/tombstone.e2e.test.js` is the template for making that a permanent integration test instead of a throwaway script (set the env var *before* requiring `lib.js`, spawn `board.js` as a child, poll `list`, clean up pipe + secret file in `t.after`; `node --test` runs each file in its own process, so the override can't leak). **Every RPC in teardown/cleanup code must go through the same namespaced env** — a bare `rpc({cmd:'shutdown'})` with no `AGENT_RELAY_PIPE` hits the production board and ends every live line on it.

**Client** (`client/`) — Vite + React, no router
- Navigation is manual screen state, no router. `App.jsx` owns the `boot`/`login` → authenticated transition, then hands off to one of two shells (chosen once per window — see `core/shellSelection.ts`). Each shell owns its own `useSessions` data layer and the single create dialog, and sub-navigates internally, so the screens/panes below stay presenters:
  - `MobileShell.jsx` — the phone screen stack: owns the `sessions` → `terminal` sub-nav (`activeSession`), the create dialog + create-and-attach, and passes `sessions`/`onKill`/`onNewSession` down. The dialog opens prefilled from the current directory when a terminal spawns a sibling (`onNewInDir`).
  - `desktop/DesktopWorkspace.jsx` — the single master-detail workspace (see the desktop bullet-cluster around `Sidebar`/`DetailPane`/`PaneGrid`).
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
- `TerminalScreen.jsx` — thin chrome around `<TerminalView>`: header (status dot fed by `onStatusChange`, copy-selection via the view's handle), footer, back button, and a "New session here" action (`onNewInDir(session.cwd)`) that opens the shell's create dialog prefilled with the current directory.
- `SessionsScreen.jsx` — a presenter over the mobile shell's data layer (`sessions`/`onKill`/`onAttach`/`onNewSession` props, no `useSessions` of its own): cards (each with its attention state — a pulsing `online` dot + "running" label, or a static `idle` dot labeled "quiet", mapped from the DTO's `running`/`idle` in the card's `ATTENTION` table), filter, a collapsed "Recently exited" section (tombstone cards with a `killed` / `exit N` badge; dismiss reuses `kill`, which the server maps to the board's `forget`), and the pair-a-device dialog. The "New session" button just signals `onNewSession`.
- `chrome/NewSessionDialog.jsx` — the shared create dialog, opened by whichever shell owns it (stays open until a create succeeds, so a failure surfaces instead of vanishing into an unhandled rejection). `initialCwd` prefills the working directory (the "New session here" flow; `~/` from scratch). Its claude model/effort chips splice flags via `core/claudeFlags.ts`; last-used values persist to `localStorage` on a successful claude spawn and prefill the next claude command (server-side defaults store deferred to spawn-templates phase 2).

**Design system** (`_docs/design-system/`)
- Core UI components live in `_docs/design-system/components/core/` and are imported via the `@ds` Vite alias (e.g. `import { Button } from '@ds/Button.jsx'`). These are plain React with a runtime-injected `<style>` singleton (real class-based CSS — `:hover`, `:focus-visible`, `@keyframes` — not inline styles), which keeps them a zero-build portable kit for `_ds_bundle.js` + the standalone preview pages. Deliberately **not** migrated to SCSS Modules (ADR-0006 §4).
- **App-owned client UI uses SCSS Modules** (`.module.scss`, colocated, scoped) — `screens/`, `chrome/`, `desktop/`, `App`, and `TerminalView`. Zero static inline `style={{}}` in `client/src`; only genuinely dynamic per-render values stay inline. `sass` is a client devDep; Vite compiles `.module.scss` (modern API, see `vite.config.js`). Typechecked core (`core/*.tsx`) needs the ambient `*.module.scss` declaration in `core/css.d.ts`. See ADR-0006.
- Design tokens are CSS custom properties defined in `_docs/design-system/tokens/`. Theming is done by toggling `data-theme="dark|light"` on `<html>` in `App.jsx`. Stylesheets consume `var(--...)`; tokens are **not** ported to SCSS `$variables` (that would kill runtime theme-switching).

**Dev proxy** (Vite config)
- `/api/*` → `http://localhost:3017` (REST)
- `/sessions/*` → `ws://localhost:3017` (WebSocket, `ws: true`)

In production the client is served statically by Express (`server/src/static.js`, from `client/dist` — build with `npm run build`), so the proxy is only needed in dev.

## Open issues

| Issue | Pri | Effort | File |
|---|---|---|---|
| Windows secret-file ACL is unverified — `mode` bits are inert on NTFS; the real boundary is the inherited profile ACL (deferred W1). Raised 2026-07-06: the persisted token + cookie-signing secret now live behind the same unverified assumption | P2 | S | `_docs/issues/2026-07-01-secret-file-acl-verification.md` |

## Feature backlog (proposed, not started)

One doc per idea under `_docs/issues/`, each with motivation, outline, risks, and the signals that should trigger picking it up. Rough dependency order: tunnel/QR unlocks push, push unlocks notification actions.

**Priorities:** **P1** = do next, **P2** = soon, **P3** = wait for its trigger signal. **Effort:** S/M/L.

**Deployment reality (tunnel/push):** the office network DNS-filters Tailscale, so at work the tunnel degrades (by design) and the phone path is the Remote Desktop app (see the two 2026-07-06 RDP issues); the tunnel path is fully usable on unfiltered networks, and push/PWA still need a secure origin (App Proxy or tailnet) before they unblock.

| Idea | Pri | Effort | File |
|---|---|---|---|
| One-tap spawn templates **— phase 2 only** (server-side `/api/templates` store; phase 1 localStorage picker landed) | P3 | M | `_docs/issues/2026-07-02-fleet-spawn-templates.md` |
| Scrollback persistence: transcripts survive line exit / board restart | P2 | L | `_docs/issues/2026-07-02-scrollback-persistence.md` |
| Hook-driven Web Push when a session needs attention (blocked on secure origin; Pushover covers the need meanwhile) | P3 | M | `_docs/issues/2026-07-02-hook-driven-push-notifications.md` |
| Approve/deny prompts from notification action buttons (needs Web Push delivery — Pushover can't host approve/deny) | P3 | L | `_docs/issues/2026-07-02-notification-action-buttons.md` |
| Claude-native lines **— narrowed 2026-07-07 to the transcript-tailing bet** (JSONL tailer + chat view; binding comes from hook-beaconed session state, landed; grill first) | P3 | L | `_docs/issues/2026-07-02-claude-native-lines.md` |
| Transcript resume launcher: list *dormant* Claude JSONL transcripts (metadata only) and `claude --resume` one into a live PTY line — sibling to claude-native-lines but relaunch-not-render, so ships ahead of the privacy gate; dedup leans on hook-beaconed state | P3 | M | `_docs/issues/2026-07-07-transcript-resume-launcher.md` |
| Scoped tokens (read-only / per-session input; prerequisite for any multi-user or App Proxy rollout) | P3 | M | `_docs/issues/2026-07-02-scoped-tokens.md` |
| Paired/connected device dashboard + per-device unpair | P3 | M | `_docs/issues/2026-07-06-paired-device-dashboard.md` |
| Desktop shell v3: fleet extras — broadcast input + local-trust endpoints remain (live-preview card/row tail **landed 2026-07-16**, closing the 2026-07-01 preview issue); items ship independently | P3 | M | `_docs/issues/2026-07-07-desktop-fleet-extras.md` |
| Agent-judged notifications: replace the always-on `Stop` "turn done" push with a judged one — Claude self-notifies with a meaningful message when a turn actually merits it (keep the `Notification` blocked-state hook; a judge-in-`Stop` variant is the costlier alternative). Smarter caller of the landed `/api/notify`, no relay change | P3 | S | `_docs/issues/2026-07-15-agent-judged-notifications.md` |
| In-app toasts - **error slice landed 2026-07-21** (`Toast` core component + pure `toastQueue` + `useToast` host on both shells; sticky relay-unreachable, failed-kill, failed-create toasts). Remaining: the session-lifecycle slice (exit/crash from the poll diff) and the cross-surface attention slice (the `notifyTransitions` two-sink refactor) | P2 | M | `_docs/issues/2026-07-21-in-app-notifications.md` |
