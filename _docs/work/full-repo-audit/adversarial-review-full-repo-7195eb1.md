## Adversarial Review: full-codebase audit (agent-relay)

**Scope:** Entire repository at `HEAD` — not a diff against `main` (this branch has no code changes over main; this is a from-scratch review of every reviewable source file). Reviewed as three subsystem slices, each fanned out to isolated Saboteur / Maintainer / Security Auditor persona subagents (plus a Capacity Planner on the board kernel, which has the only genuine hot-path/buffer-growth surface in the repo), followed by an orchestrator seam pass across the slice boundaries:

- **Board kernel** (`server/board/*.js`, `*.ps1`, `*.vbs`) — the vendored PTY daemon and its CLI/MCP surface.
- **Web tier** (`server/index.js`, `server/src/*.js`) — the Express+WS layer that fronts the board.
- **Client** (`client/src/**`, `client/index.html`, `client/public/*`) — the React SPA.
- **Root/scripts** (`scripts/free-port.js`, `autostart.ps1`, `start-relay.vbs`, `package.json` files) — reviewed in-context by the orchestrator (low risk, no fan-out warranted).

Excluded from the three-persona treatment per the skill's scoping rules: `_docs/**` (docs/issue-tracker markdown), `_docs/design-system/**` (design tokens, the core `@ds` component library, and the `ui_kits/agent-relay/*.jsx` reference mockups — confirmed via grep that nothing under `client/` imports from `ui_kits/`, so these are documentation artifacts, not shipped code), `package-lock.json` (lockfile), and `agent-relay.code-workspace` (trivial editor config).

**Reviewed:** `4b825dc` (empty tree) `..` `7195eb1` (current `HEAD` on `chore/full-repo-audit`) — i.e., every file in the repo.

**Verdict:** BLOCK (2 CRITICAL findings)

---

### Critical Findings

**C1. The MCP server's read-cursor cache has no lifecycle: it leaks forever, silently corrupts output after a board restart, and races under concurrent reads** — `server/board/mcp-server.js:33,54-56,61` · confidence 80

**Status:** ✅ Resolved in 1a166d3 — see below.
**Resolution:** Accepted as framed (verdict A); all three sub-defects were real. Fixed at the source of each: (1) board.js now stamps a per-process boot nonce (`BOOT = pid-timestamp`) and echoes it in both the `new` and `list` replies; mcp-server keys `seen` by `"<boot>:<id>"` and clears the whole cache when a `list` reports a changed boot, so a reused id after a board restart can never inherit a stale cursor. (2) The entry is now `seen.delete`d when the replayed stream contains the board's exit sentinel (reusing `EXIT_RE` from `wait.js`), closing the leak. (3) The cursor advance is now `seen.set(key, Math.max(already, text.length))` — monotonic, so overlapping reads can't roll it backward (re-deliver) or be corrupted by a shorter racing snapshot. Closure check: a standalone harness mirroring the exact `finish()`/`refreshBoot()` decision proves all three (reused-id-under-new-boot returns its own output not `""`; exit sentinel drops the entry; racing shorter snapshot keeps cursor at max) — the same reused-id case returns `""` under the old logic (red) and the correct output under the new (green). No automated suite exists in this repo, so the guarded paths are `mcp-server.js:refreshBoot()` + the `finish()` cursor block, and `board.js` `BOOT` + the `new`/`list` reply writers. Landed in 1a166d3.

---

Three independent lenses (Saboteur, Maintainer, Capacity Planner) converged on the same defect from three different angles, which is what promotes this to CRITICAL:

1. **Unbounded growth (Capacity Planner, confidence 75).** The module-level `seen` Map is keyed by line id and populated on every `switchboard_read_output` call (`seen.set(id, text.length)`), but nothing ever calls `seen.delete(id)` — not on line exit, not on `switchboard_end_line`, nowhere. Since this MCP server process is explicitly designed to survive Claude Code session restarts/compaction (per its own tool description), it can run for days, and every distinct line ever read through it leaves a permanent entry.
2. **Silent data corruption after board restart (Saboteur + Maintainer, confidence 70-80).** Line ids come from a process-local counter (`seq` in `board.js:25,28`) that resets to `0` whenever the board restarts — and board restarts are a *designed, expected* occurrence: both `mcp-server.js` and `sb.js` auto-restart the board via `connectControl({autostart:true})` whenever it's down (`lib.js:48-69`). If a fresh line reuses an old id (e.g. `"1"`), it inherits the old `seen` cursor value, and `readOutput`'s `text.slice(already)` silently returns truncated or empty output for the new line's early bytes — no error, just missing output that looks like the tool worked.
3. **Concurrency race (Saboteur, confidence 60).** Each `readOutput` call opens its *own* socket to the line's data pipe and gets its own full scrollback replay, but all concurrent calls for the same id write to the *same* shared `seen` entry unconditionally (`seen.set(id, text.length)`, no max-guard). Two overlapping reads (plausible — an agent double-invoking the tool, or `switchboard_wait_for_idle` racing `switchboard_read_output`) can roll the cursor backward (re-delivering already-returned output) or jump it forward (silently skipping a chunk that's never delivered to anyone).

**Fix:** Key `seen` by a value that can't be reused across board restarts (e.g. combine id with a boot nonce/PID the board hands back), clear the entry on line-exit detection (reuse the `EXIT_RE` sentinel pattern from `wait.js`), and guard concurrent updates with `seen.set(id, Math.max(seen.get(id) ?? 0, text.length))` or a per-id serialization queue.

**C2. `sessions.list()` swallows every board failure into an empty array — "board is down" and "zero sessions exist" are indistinguishable everywhere in the web tier** — `server/src/sessions.js:44-46` · confidence 75

**Status:** ✅ Resolved in 5ac451f — see below.
**Resolution:** Accepted as framed (verdict A). `list()` no longer catches to `null`/`[]`: an RPC rejection or a non-ok reply now throws a `BoardUnreachableError` (with a `boardUnreachable` flag) after logging the underlying error via `console.error` — so a genuinely empty session list (`{ok:true, lines:[]}`) still returns `[]`, but "board down" is now a distinct, observable signal. Consumers were updated to honor the distinction: `GET /api/sessions` and `GET /api/sessions/:id` answer **503** on `boardUnreachable` (falling through to the generic error path otherwise), and `ws.js` wraps the `get()` existence check in try/catch — a board-unreachable failure closes with **1013 (Try Again Later)** so the client keeps reconnecting, versus **1008 (session not found)** which is permanent and stops the retry loop. This is what stops every live session looking dead during a transient board restart. Closure check: `c2-list.js` requires the real `sessions.js` with a stubbed `board-client.rpc` and asserts board-down/non-ok both throw `BoardUnreachableError` (returned `[]` under the old code — red→green) while empty-but-ok returns `[]`; the log lines confirm the debuggability requirement. Guarded paths: `sessions.js:BoardSessions.list()`, `api.js` GET handlers, `ws.js` connection guard. Landed in 5ac451f.

---

Two distinct lenses converged here: the Saboteur (confidence 80) flagged the reliability failure mode, the Maintainer (confidence 70) independently flagged the silent-swallow-with-no-log debuggability problem.

`list()` does `const r = await rpc({cmd:'list'}).catch(() => null); return r && r.ok ? r.lines.map(toDto) : [];` — any RPC failure (board not running, pipe error, malformed reply) produces the same `[]` as a genuinely empty session list. This propagates two ways: `GET /api/sessions` returns a 200 with `[]` (the UI shows "no sessions yet" instead of any error), and — more seriously — `ws.js:15` calls `sessions.get(id)` (which calls `list()` internally) to validate a session exists *before* attaching. During any board hiccup (a restart is a normal, autostart-triggered event per C1's context, and per CLAUDE.md any change to `server/board/*` requires a full board restart), **every single active session becomes unattachable** — every WebSocket connection attempt gets closed with `1008, 'session not found'`, even for lines that are still perfectly alive on the board once it comes back — with zero log line or diagnostic signal anywhere in the stack. For a tool whose entire purpose is maintaining continuous terminal access, "every session looks dead during a transient, self-healing condition, and there's no way to tell that from the sessions actually being gone" is a severe, silent reliability failure.

**Fix:** Let `list()` propagate a distinguishable failure (throw, or a sentinel distinct from `[]`) instead of swallowing to empty; have `api.js` return 503 and `ws.js` use a distinct close code/reason for "board unreachable" vs "session not found"; log the swallowed error at minimum.

---

### Warnings

**W1. Login probe sends the real access token to an attacker-controllable host with zero validation** — `client/src/screens/LoginScreen.jsx:9-28` · confidence 85

**Status:** ✅ Resolved in e4ca986 — see below.
**Resolution:** Accepted as framed (verdict A). `connect()` now refuses to send the token to a host it hasn't successfully connected to before, unless the host is localhost/loopback (where the token can't leave the machine). A separate `ar-host-trusted` key records the last host a probe actually *succeeded* against; the convenience `ar-host` seed is explicitly treated as untrusted (it's the attacker-controllable value). The first Connect click to an untrusted non-localhost host shows a visible warning naming the destination and requires a second, confirming click before the token is sent. Closure check: `w1-hostguard.js` proves the guard predicate (`token && !isLocalhost(h) && h !== trusted && pendingHost !== h`) blocks on the exfil path (untrusted non-localhost, first click) and correctly passes for localhost, loopback IP, a previously-trusted host, the confirming second click, and the no-token case; client Vite build green. Guarded path: `LoginScreen.connect()` trust gate + `isLocalhost()`. Landed in e4ca986.

---

The "Relay host" field is seeded from `localStorage.getItem('ar-host')` with no check that it matches a previously-trusted value, and `connect()` immediately sends the typed token as a Bearer header to whatever origin that resolves to — before any confirmation the host is legitimate. If an attacker can get `ar-host` pre-set to an attacker-controlled origin (a crafted link/QR code that runs a one-time script, a malicious extension, a shared machine), the next time the operator types their real token and clicks Connect, the token goes straight to the attacker's server on the very first request, with no visible warning that the host differs from what the operator expects.

**Fix:** Warn visibly when the current host input differs from the last-successfully-connected host (or isn't localhost) before the Connect button fires the request carrying the token.

**W2. `SessionCard`/`TerminalPreview` renders a field the server never sends — the output-preview feature is entirely dead** — `client/src/screens/SessionsScreen.jsx:13,61` + `server/src/sessions.js:30-40,63-71` · confidence 80

**Status:** ✅ Resolved in 0470132 — see below.
**Resolution:** Accepted (verdict A), took the reviewer's "remove the dead UI and file it as a known TODO" branch rather than building out the server wiring, because wiring a real preview (a new board `list` field + per-poll cost decisions) is a feature bigger than the cited scope. Removed the `TerminalPreview` component and its `session.preview` usage from `SessionsScreen.jsx` (following the "remove dead code arms that actively mislead" precedent — the widget permanently claimed "no output yet" and read as a working feature), left an inline NOTE at the removal site explaining where the scrollback lives one layer down, and filed the revival as a tracked enhancement at `_docs/issues/2026-07-01-session-card-live-preview.md`. Closure check: the dead code is gone (no reference to `session.preview` remains) and the client Vite build is green. Landed in 0470132.

---

`TerminalPreview` renders `session.preview.slice(-4)`, but neither `toDto()` nor `spawn()` in `sessions.js` ever populates a `preview` key — the DTO only carries id/name/shell/cwd/pid/status/lastActive. Every card permanently shows "no output yet." This reads as a working feature; a future maintainer will spend real time hunting for where preview data is supposed to come from before discovering the server-side wiring was never built (the board does keep a 2000-chunk scrollback per line, so the data exists one layer down).

**Fix:** Wire an actual scrollback-tail through `BoardSessions.list()`/`toDto()`, or remove the dead UI and file it as a known TODO.

**W3. Bearer-header construction is duplicated ad hoc in `LoginScreen` instead of reusing `api.js`'s `headers()`** — `client/src/screens/LoginScreen.jsx:22-24` · confidence 75

**Status:** ✅ Resolved in e4ca986 — see below.
**Resolution:** Accepted as framed (verdict A). `headers()` in `client/src/api.js` is now `export`ed and `LoginScreen.connect()` imports and calls it for the probe fetch instead of hand-building `{ Authorization: \`Bearer ${token}\` }` inline — the auth-header scheme now has one source of truth, so a future scheme change lands in one place and `grep headers(` surfaces both call sites. Closure check (maintainability finding, no behavior change): the guarded path is the single `headers` export in `api.js` consumed by both `api.js`'s fetch wrappers and `LoginScreen`; client Vite build green with the new cross-module import. Landed in e4ca986.

---

`api.js` centralizes the guarded `Authorization: Bearer ${token}` pattern in `headers(token)`, but `LoginScreen.connect()` reimplements the identical expression inline. If the auth scheme ever changes, a maintainer fixing `api.js` has no signal `LoginScreen` needs the same edit, and grepping for `headers(` won't surface the second copy.

**Fix:** Export `headers()` (or a `probeConnection(host, token)` helper) from `api.js` and have `LoginScreen` call it.

**W4. `handleCreate` has no error handling — a failed session create silently closes the dialog with no feedback** — `client/src/screens/SessionsScreen.jsx:186-190` · confidence 75

**Status:** ✅ Resolved in 963d021 — see below.
**Resolution:** Accepted as framed (verdict A). `handleCreate` now wraps `createSession` in try/catch and only closes the dialog + attaches on success; on failure it keeps the dialog open and sets a `createError` shown in the dialog (mirroring `LoginScreen`'s error pattern), and a `creating`/`busy` flag disables the button during the request. `NewSessionDialog` gained `error` and `busy` props to render this. The unhandled-rejection path (dialog vanishes, nothing created, no feedback) is gone. Closure check: the guarded path is `handleCreate`'s try/catch — the `setDialog(false)`/`onAttach` are now inside the `try` after the awaited create, and the `catch` surfaces the error; client Vite build green. Landed in 963d021.

---

`setDialog(false)` fires immediately, then `await createSession(opts, token)` with no try/catch; `createSession` throws on any non-ok response (expired token, 500, network drop). The rejection becomes an unhandled promise rejection — the dialog vanishes, no session is created, and the user sees nothing. Every other fetch call site in this app (`LoginScreen.connect`, `SessionsScreen.load`) wraps its call in try/catch; this is the one that doesn't.

**Fix:** Wrap in try/catch; on failure, reopen the dialog and show an error message consistent with `LoginScreen`'s pattern.

**W5. Session DTO shape is hand-duplicated across `toDto()` and `spawn()` and can silently drift** — `server/src/sessions.js:30-40,63-71` · confidence 75

**Status:** ✅ Resolved in babe7b7 — see below.
**Resolution:** Accepted as framed (verdict A), fixed by the reviewer's second suggested route (make the board's `new` reply echo the `list` shape). As part of the C1 commit the board's `new` handler now echoes `cwd` (and `boot`); `spawn()` now builds its DTO via `{ ...toDto({ id, name, shell, cwd, pid, idleMs: 0 }), lastActive: 'just now' }` off that reply instead of hand-assembling an equivalent object — so `toDto()` is the single mapping for both paths and a future field added to it appears on a just-spawned session automatically. Closure check: `w5-spawn.js` asserts `Object.keys(spawnDto)` === `Object.keys(listDto)` against the real `sessions.js` (they'd diverge under the old hand-built object) plus the `lastActive` override. `toDto` was also hardened to `pid ?? null` to preserve the prior spawn semantics. Landed in babe7b7.

---

`toDto(line)` is the documented single mapping from a board "line" to the session DTO, but `spawn()` doesn't call it — it hand-builds an equivalent object, because the board's `new` RPC reply (`board.js:122`) only echoes `{id, pid, shell, name, dataPipe}`, missing `cwd`/`idleMs`. That constraint isn't documented at either call site, so a future field addition to `toDto()` won't automatically appear on a just-spawned session until the next `list()` poll, with nothing enforcing the two stay in sync.

**Fix:** Comment the constraint at `spawn()`'s return, or have the board's `new` handler echo the same shape as its `list` entries so `toDto()` can be shared.

**W6. Express has no custom error handler — RPC/board failures leak internal stack traces in HTTP responses** — `server/index.js:11-19` (missing) + `server/src/api.js` (all routes `next(e)`) · confidence 70

**Status:** ✅ Resolved in 245406e — see below.
**Resolution:** Accepted as framed (verdict A). Installed a final arity-4 error-handling middleware in `index.js` after the `/api` router: it logs `err.stack` server-side via `console.error`, then returns a generic `{ error: 'internal error' }` (500) with no message or stack in the body — or `{ error: 'board unreachable' }` (503) when the error carries the `boardUnreachable` flag, keeping it consistent with the C2 per-route handling as a backstop. Guards `res.headersSent`. Closure check: `w6-errhandler.js` mounts the exact handler with a route that throws a message containing a fake secret path and asserts the 500 response body is exactly `{error:'internal error'}` with the secret and stack frame absent (the default Express handler would include both), and that a `boardUnreachable` error yields 503. Landed in 245406e.

---

Every route forwards errors via `next(e)`, and `index.js` never installs error-handling middleware, so Express's default handler applies — which includes the full stack trace in the response body whenever `NODE_ENV` isn't `production` (the default here, since it's never set). Any board-client failure (pipe error, malformed reply, a `pty.spawn` throw) becomes a 500 response leaking internal file paths and stack frames to anyone who can reach `/api` — which, per the AR_TOKEN-unset case, may be anyone.

**Fix:** Install a final error-handling middleware that logs server-side and returns a generic `{error: 'internal error'}` with no message/stack.

**W7. The board's control-pipe RPC protocol is independently reimplemented three times across the codebase, with no shared helper** — `server/board/sb.js:19-31`, `server/board/mcp-server.js:15-28`, `server/src/board-client.js:10-23` · confidence 70

**Status:** ✅ Resolved in 619c1cd — see below.
**Resolution:** Accepted as framed (verdict A). Extracted a single `rpc(msg, { autostart, retries, delay, timeout })` into `server/board/lib.js` (which all three files already imported) and deleted the three near-identical local copies: `sb.js`, `mcp-server.js`, and `board-client.js` now import the one helper. A protocol/framing change now has one call site. Bundled with N8 (the shared helper carries a 10s default timeout — see that finding). Closure check: `w7-rpc.js` asserts `board-client.rpc === lib.rpc` (identity, so no lingering local copy) and drives the shared helper against a real in-process control pipe (isolated via `AGENT_RELAY_PIPE`) confirming framed request/response still works. Landed in 619c1cd.

---

A seam-crossing finding: the board-slice Maintainer flagged the `sb.js`/`mcp-server.js` pair as duplicated ~15-line "write one JSON line, read one JSON line back" implementations; the web-tier Maintainer independently flagged `board-client.js`'s copy of the identical pattern and its lack of a timeout, noting the risk of the three copies drifting. All three exist because `lib.js` (which every one of them already imports for `connectControl`/`connectPipe`) doesn't also own the request/response framing. A future protocol change (a timeout, a different framing scheme) has three call sites to update, with nothing signaling they're linked — and one already lacks a timeout while the others might independently grow one, exactly the drift the maintainers warned about.

**Fix:** Extract one `rpc(msg, opts)` into `lib.js`, imported by all three.

**W8. `POST /sessions` forwards `req.body` fields to `pty.spawn` with zero validation** — `server/src/api.js:13-18` · confidence 70

**Status:** ✅ Resolved in 94ac1dc — see below.
**Resolution:** Accepted as framed (verdict A). Added `validateSpawnBody()` to `api.js`: each of `name`/`cwd`/`shell`/`command` remains optional, but any present value must be a string within a per-field cap (`name` 200, `cwd` 4096, `shell` 500, `command` 8192 chars); a violation returns **400** with a specific message before `sessions.spawn` is ever called. This closes both the opaque-500 path (a non-string `cwd` throwing inside `resolveCwd().trim()`) and the unbounded-`command` path (a multi-MB string typed into a live shell). Closure check: `w8-validate.js` mounts the real `createAPI` with a spy `sessions.spawn` and asserts an array `cwd` and an 8193-char `command` each yield 400 with `spawn` never reached, while a valid body reaches `spawn` with 201 and an empty body is accepted. Landed in 94ac1dc.

---

`name`/`cwd`/`shell`/`command` are destructured with no type/shape/length checks before reaching `sessions.spawn` → the board's `pty.spawn`. A non-string field (e.g. `cwd` as an array) throws inside `resolveCwd`'s `.trim()` before the route's own try/catch cleanly applies, producing an opaque 500. There's also no length cap — a client with a valid token can send a multi-MB `command` that gets typed into a real shell via the board's `run` field.

**Fix:** Validate string type and a sane length for all four fields; return 400 on violation instead of falling through to `pty.spawn`.

**W9. Magic timing constants for the initial-command feed have no named constants or shared rationale** — `server/board/board.js:74-81` · confidence 65

**Status:** ✅ Resolved in f152040 — see below.
**Resolution:** Accepted as framed (verdict A). Hoisted the bare `120`/`1500` literals to module-scope `FEED_DEBOUNCE_MS` and `FEED_FALLBACK_MS` with a comment explaining each role (debounce after each output burst vs. hard backstop for a silent shell), and the feed site references them by name. Pure rename, behavior-neutral. Closure check: named guarded path (the two constants at the feed site — no bare `120`/`1500` remain there) plus the board runtime smoke test (isolated `AGENT_RELAY_PIPE`) confirming the daemon still boots and feeds a `run` command. Landed in f152040.

---

The `120ms`/`1500ms` values driving the `run`-field keystroke injection are bare numeric literals with only a prose comment explaining ConPTY's keystroke-drop behavior. A future maintainer tuning shell-startup latency has to re-derive which number means what from the comment alone, with no single source of truth if the logic needs touching in more than one place later.

**Fix:** Hoist to named constants (`FEED_DEBOUNCE_MS`, `FEED_FALLBACK_MS`) at module scope.

**W10. `SessionsScreen`'s 5s poll and in-flight kill/create requests aren't sequenced — stale responses can resurrect or flicker a just-killed session** — `client/src/screens/SessionsScreen.jsx:180-195` · confidence 65

**Status:** ✅ Resolved in b503aaa — see below.
**Resolution:** Accepted as framed (verdict A). `load()` now stamps a monotonic sequence (`loadSeq`) per call and refuses to apply a response older than the last one applied (`latestApplied`), so an overlapping/slow poll can't stomp a newer result. `handleKill` adds the id to a `killed` ref set *before* the DELETE and `load()` filters that set out of every response — so a just-killed session can't flicker back from an in-flight poll's stale snapshot; after the DELETE resolves, `handleKill` reconciles with a fresh `load()` and then removes the mark. All three are refs (not state) so they don't retrigger the effect. Closure check: `w10-race.js` mirrors the seq-drop + killed-filter logic and asserts (a) an older response resolving after a newer one is dropped, and (b) a killed id is filtered out of a stale poll and stays gone after reconciliation; client Vite build green. Landed in b503aaa.

---

The poll interval and `handleKill`'s optimistic local filter run independently with no in-flight guard on `load()`. Walk it through: kill session X fires; before the DELETE resolves, the next poll tick's `load()` returns the server list still containing X and overwrites state; when the DELETE then resolves, `prev.filter(...)` removes X again — but if a second poll interleaves in between, X can flicker back into view for up to another 5s cycle. More generally, overlapping `load()` calls have no ordering guarantee, so an older response can stomp a newer one.

**Fix:** Guard `load()` against overlapping calls (in-flight ref or `AbortController`), and have `handleKill` either skip the next poll tick or merge the kill into whatever the poll returns rather than relying on stale `prev`.

**W11. Named pipes are created with no explicit ACL restriction** — `server/board/board.js:51,196` · confidence 55

**Status:** ⏸ Deferred — see [issue doc](../../issues/2026-07-01-named-pipe-dacl-verification.md).
**Resolution:** Recommended verdict **D** (park for the user's decision). The finding is a *verify-then-maybe-fix*: it asks to first confirm the effective DACL on a live pipe, then apply a restrictive security descriptor only *if* it's broader than the creating user. The verification could not be done in the remediation environment (no AccessChk available; named-pipe DACLs aren't inspectable via `icacls`/`Get-Acl` without native P/Invoke), and the conditional fix is a real security-hardening change bigger than the cited scope — it likely needs native `CreateNamedPipe`/`SECURITY_ATTRIBUTES` interop and must not break the intentional *same-user, cross-process* access the board relies on (web tier, `sb`, `mcp-server`, WezTerm panes). Guessing at a DACL fix unattended risks breaking that design. Parked with a standalone issue doc capturing the verification step, the conditional fix outline, and reopen triggers.

---

Both the control pipe and every per-line data pipe call bare `net.Server.listen(pipePath)` with no explicit Windows security descriptor. Node exposes ACL-related listen options specifically because libuv's default named-pipe DACL is not guaranteed to be scoped to the creating user/session — this is a plausible, checkable gap (not independently verified live with `icacls`/AccessChk in this pass) that would upgrade the documented "board has no auth, trust the local user" design from accepted-by-design to a concrete escalation if the actual DACL is broader than same-user.

**Fix:** Verify the effective DACL with `icacls \\.\pipe\agent-relay` while the board is running; if broader than the creating user, apply an explicit restrictive security descriptor.

**W12. `resize` control messages trust unvalidated `cols`/`rows` into `Math.min`/`pty.resize`, which can wedge a line's size on garbage input** — `server/board/board.js:151-154,91-96` · confidence 55

**Status:** ✅ Resolved in 07db618 — see below.
**Resolution:** Accepted as framed (verdict A). Added an `isDim = n => Number.isInteger(n) && n > 0` guard; the `resize` handler now stores a client's size only when both `cols` and `rows` pass it. A non-numeric/`NaN`/zero/negative/float value is ignored instead of being stored and folded through `applyMin`'s `Math.min`, which previously poisoned every subsequent resize for the line. Closure check: `isDim` unit assertions (rejects `'x'`/`null`/`NaN`/`0`/`-5`/`1.5`, accepts `80`/`24`), plus a runtime test (`w12-resize.js`, isolated board) that fires `{cols:'x',rows:null}` followed by a valid resize and confirms the board stays responsive and the line is still listed — i.e. not wedged. Landed in 07db618.

---

The `resize` handler stores `{cols: m.cols, rows: m.rows}` straight from parsed JSON with no type check; `applyMin` folds all sizes via `Math.min` starting from `Infinity`. A non-numeric value (`{cols:"x", rows:null}`) propagates `NaN` through every subsequent `applyMin` call on that line — every pane's resize breaks — until the poisoned client disconnects. The surrounding `try/catch` silently swallows whatever `node-pty` does with `resize(NaN, NaN)`. Not reachable via the intended client (`patch.js` always sends real numbers), but the control pipe has no schema validation anywhere and is reachable by any local process per the documented trust model.

**Fix:** Validate `cols`/`rows` are finite positive integers before storing/using them.

**W13. `spawn()`'s returned `cwd` is the client's own `resolveCwd()` output, not an echo of what the board actually used** — `server/src/sessions.js:52-71` · confidence 55

**Status:** ✅ Resolved in babe7b7 — see below.
**Resolution:** Accepted as framed (verdict A). The board's `new` reply now echoes the `cwd` it actually recorded (added in the C1 commit), and `spawn()` reports `r.cwd ?? wd` — the board's value when present, the client's `resolveCwd()` output only as a fallback for an older board. If the board ever normalizes cwd differently from `resolveCwd`, the DTO now reflects the board's truth. Closure check: `w5-spawn.js` feeds a board reply whose `cwd` differs from `resolveCwd('~/')` and asserts the DTO carries the board's value, plus a fallback case where the board omits `cwd`. Landed in babe7b7 (bundled with W5, same one-line fix).

---

Today these coincide because `resolveCwd` is a pure deterministic transform, but the board never echoes back the `cwd` it actually recorded (`board.js:39` stores it as received, with no confirmation in the `new` reply). If the two ever diverge (board-side normalization, a spawn fallback), the DTO would silently misreport where the shell launched, with no round-trip validation catching it.

**Fix:** Have the board's `new` reply echo the resolved `cwd` it used, matching the `list` reply's shape.

**W14. `sessions.get(id)` then `sessions.attach(id)` is a TOCTOU: a session can be killed between the existence check and the attach** — `server/src/ws.js:15,24` + `server/src/sessions.js:48-50` · confidence 55

**Status:** ✅ Resolved in 37c9267 — see below.
**Resolution:** Re-framed (verdict B). The reviewer's framing pointed at the *race itself* and prescribed a board-atomic by-id attach path — but the get()→attach() gap is inherent to any distributed board (a line can end at literally any instant, including *after* an atomic check), so eliminating the round-trip wouldn't remove the window; it would just move it. The genuinely fixable, in-scope defect the finding also identified is the **misleading close reason**: a line ending in the gap fell through to `catch { ws.close(1011, 'attach failed') }`, telling the client a normal session-end was a retryable error. Fixed by binding the attach error and mapping an ENOENT/ECONNREFUSED (the data pipe is gone) to `ws.close(1008, 'session not found')` — the same permanent, correct signal the up-front existence check uses — versus 1011 only for a genuine attach failure. The remaining "collapse the two round-trips into one board-atomic call" is a larger board-protocol change left out of scope (it wouldn't close the race). Closure check: confirmed `board-client.attach()` on a nonexistent line rejects with `e.code === 'ENOENT'`, which the new branch keys on; `ws.js` syntax-checked. Landed in 37c9267.

---

Two overlapping lenses (Maintainer, Security) independently described the same race, so this is reported once rather than promoted (they weren't materially distinct fears). `get()` round-trips a full `list()` to check existence, then a separate `attach()` RPC follows; a session killed in that window isn't caught by a clean "not found" path — it falls through to the generic `catch { ws.close(1011, 'attach failed') }`, a confusing close reason for what is really "the session just ended."

**Fix:** Have the board expose a direct by-id existence/attach path so the check and the attach aren't two independent round-trips.

---

### Notes

**N1. Root and board-daemon autostart scripts are near-identical, hand-duplicated PowerShell** — `autostart.ps1` (repo root) vs `server/board/autostart.ps1` · confidence 55

**Status:** ⏸ Deferred — see [issue doc](../../issues/2026-07-01-duplicated-autostart-scripts.md).
**Resolution:** Recommended verdict **D** (park). The duplication is real, but the board copy is *vendored* from the switchboard kernel — deduplicating into a shared parameterized script would modify the vendored file and diverge it from upstream, so the call trades duplication against keeping the vendored tree pristine. That's the user's judgment, not a mechanical cleanup, and low-value at conf 55. Parked with an issue doc laying out both options (keep pristine vs. dedup) and reopen triggers.

---

Same structure (install/uninstall/status against a Scheduled Task, differing only by `$TaskName`/target `.vbs`) — a bug fix in one (e.g. the `CimException` handling) has no reason to remind a maintainer the sibling copy needs the same fix.

**N2. Initial `run` command text is logged in plaintext to a persistent, unrotated log file** — `server/board/board.js:81` · confidence 60

**Status:** ✅ Resolved in 8e664dc — see below.
**Resolution:** Accepted as framed (verdict A). The feed log line now records only that a run command exists and its length (`log('line', id, 'will run a command', '(<n> chars)')`) instead of the command text, so a credential embedded as an argv (e.g. `--api-key=...`) no longer lands in the persistent, unrotated `switchboard.log`. Closure check: named guarded path — the single `log(...)` at the feed site no longer passes `run`. Landed in 8e664dc.

---

`log('line', id, 'will run:', run)` writes the full command text to `switchboard.log` next to `board.js`, with no rotation or redaction. A command embedding a credential as an argv (e.g. `--api-key=...`) lands in plaintext indefinitely.

**N3. `board.js`'s scrollback array uses `Array.shift()` — O(n) per PTY event, but bounded at n=2000 so the realistic cost is small** — `server/board/board.js:56-57` · confidence 60

**Status:** ✋ Rejected — finding is incorrect (as an action item).
**Resolution:** Verdict E — no change. The finding is self-defeating: it explicitly concludes "not worth fixing pre-emptively." The code at `board.js` (`s.buf.push(d); if (s.buf.length > SCROLLBACK) s.buf.shift();`) is correct for the documented operating envelope — `SCROLLBACK = 2000` (a hard cap on `n`) and this tool's realistic concurrency (single-digit lines, 1–3 clients each), making each `shift` a microsecond-scale memmove on a ≤2000-element array. A ring buffer would make it O(1) but adds code for no measurable gain at this scale; converting it now would be speculative optimization. Evidence: `SCROLLBACK` constant at `board.js` bounds the array; the cited lines are the only mutation site. If the cap or concurrency ever rises materially, revisit — but the code as written is not a defect.

---

Correctly classified as O(n)-per-chunk by the Capacity Planner, but at the documented `SCROLLBACK=2000` cap and this tool's realistic concurrency (single-digit lines, 1-3 clients each), each shift is a cheap microsecond-scale memmove — not worth fixing pre-emptively; a ring buffer would make it O(1) if this ever needs tightening.

**N4. `useSessionWS`'s `onmessage` has no try/catch — a malformed WS frame throws silently and freezes the terminal with no reconnect** — `client/src/screens/TerminalScreen.jsx:70-74` · confidence 55

**Status:** ✅ Resolved in c8b19c5 — see below.
**Resolution:** Accepted as framed (verdict A). `ws.onmessage` now wraps `JSON.parse(e.data)` in try/catch and returns early on a malformed frame instead of throwing. A handler exception wouldn't close the socket or fire `onerror`/`onclose`, so the connection looked "online" but silently stopped processing output and the reconnect logic never engaged; swallowing a bad frame keeps the stream alive. Closure check: named guarded path — the `try { msg = JSON.parse(...) } catch { return; }` at the top of `onmessage`; client Vite build green. Landed in c8b19c5.

---

`JSON.parse(e.data)` assumes every frame is valid JSON. Browsers don't close the socket or fire `onerror`/`onclose` on a handler exception — the connection looks "online" but stops receiving further output, and the existing reconnect logic never engages because nothing marks it unhealthy.

**N5. Four refs in `TerminalScreen` exist solely to satisfy `useSessionWS`'s exhaustive-deps opt-out, with no comment connecting the two** — `client/src/screens/TerminalScreen.jsx:120-136` (refs) / `44-100` (hook) · confidence 55

**Status:** ✅ Resolved in c8b19c5 — see below.
**Resolution:** Accepted as framed (verdict A), comment-only clarification. Added a comment block at the four-ref declarations explaining they bridge the `useSessionWS` socket effect's intentional exhaustive-deps opt-out (callbacks excluded so a callback-identity change doesn't tear down and reconnect the WS) and pointing back to the hook. No behavior change — the verified fact is that these refs exist to keep stable callbacks while avoiding reconnect churn. Closure check: the comment now co-locates the contract at the ref site; client build green. Landed in c8b19c5.

---

`onDataRef`/`onExitRef`/`refitRef`/`onBackRef` all exist because the hook's socket effect intentionally excludes its callbacks from its dependency array (stated in a two-line comment inside the hook). Nothing at the ref declarations in the component points back to that contract, so a maintainer sees four refs where a normal component would have zero, with no explanation co-located.

**N6. `wait.js`'s exit-code regex is hand-coupled to `board.js`'s exact farewell string with no shared constant** — `server/board/wait.js:11` + `server/board/board.js:61` · confidence 50

**Status:** ✅ Resolved in 8e664dc — see below.
**Resolution:** Accepted as framed (verdict A). Moved both the farewell producer and the matching regex into `lib.js`: `lineClosedFarewell(id, exitCode)` builds the string board.js writes on line exit, and `EXIT_RE` is the one regex both `wait.js` and `board-client.js` now import (rather than each defining its own copy). board.js's `onExit` writes `lineClosedFarewell(id, exitCode)`; wait.js re-exports the shared `EXIT_RE`. A reworded farewell can no longer silently break exit-code detection. Closure check: a round-trip asserts `wait.EXIT_RE === lib.EXIT_RE` (same object) and that `EXIT_RE.exec(lineClosedFarewell('7', -1))` parses back `-1` — producer and consumer provably share one source. Landed in 8e664dc (board-client's local EXIT_RE copy was also removed as part of the W7 commit 619c1cd).

---

A future wording change to the board's exit sentinel silently breaks `wait.js`'s exit-code detection (`exitCode: null` forever) with no compiler/runtime error — the comment flags it as a sentinel but the string itself isn't shared.

**N7. `openPane`'s `{cmd}` token substitution silently no-ops if the token isn't its own array element** — `server/board/board.js:106` · confidence 55

**Status:** ✅ Resolved in 9293398 — see below.
**Resolution:** Accepted as framed (verdict A). `openPane` now checks that some arg is exactly `{cmd}` before substituting; if not, it refuses to spawn and logs a clear message (specifically calling out the embedded-token case, e.g. `SWITCHBOARD_TERM="sh -c '{cmd}'"` splitting to `["sh","-c","'{cmd}'"]`, and telling the user to `sb join <id>` manually). Previously such a recipe silently spawned with the literal `{cmd}` and the pane never patched in. Did not attempt within-string substitution because the command is a multi-element argv (`[node, patch.js, id]`) that can't unambiguously be spliced into one quoted string. Closure check: predicate assertions — a standalone-`{cmd}` recipe proceeds; an embedded-only or no-token recipe is detected (`standalone:false`) and refused. Landed in 9293398.

---

Substitution only matches an argv element exactly equal to `{cmd}`; a hand-written `SWITCHBOARD_TERM` embedding the token inside a larger string (e.g. `"sh -c '{cmd}'"`) leaves it untouched, and the pane spawns with the literal wrong argv — silently, since `openPane`'s error handler only catches ENOENT-class failures, not "ran with wrong args."

**N8. `rpc()` (all three copies) has no timeout — a hung board leaves the caller waiting forever** — `server/src/board-client.js:10-23` (and its `sb.js`/`mcp-server.js` siblings, see W7) · confidence 40

**Status:** ✅ Resolved in 619c1cd — see below.
**Resolution:** Accepted as framed (verdict A), fixed as part of the W7 extraction. The single shared `rpc()` in `lib.js` now takes a `timeout` (default `RPC_TIMEOUT_MS = 10000`): if the board accepts the connection but never writes a reply, the promise rejects with `board rpc timed out after <n>ms` instead of hanging forever; it also rejects on a premature socket close and on a malformed reply. Since all three consumers now share this one helper, the fix covers the CLI, MCP, and web-tier paths at once. Closure check: `w7-rpc.js` opens a control pipe whose server deliberately never replies to a `hang` command and asserts `rpc(..., {timeout:300})` rejects with a timeout error at ~300ms. Landed in 619c1cd.

---

If the board accepts the connection but never writes a response, the promise never settles — no client-visible timeout on the HTTP/CLI/MCP side.

**N9. `LoginScreen`'s catch-all collapses distinguishable failure modes into one generic message** — `client/src/screens/LoginScreen.jsx:21-33` · confidence 40

**Status:** ✅ Resolved in e0c3f08 — see below.
**Resolution:** Re-framed and partially fixed (verdict B/A). The reviewer wanted CORS/DNS/malformed-host/network-down each distinguished — but the *post-fetch* catch genuinely cannot separate most of these: browser `fetch` collapses CORS, DNS failure, and network-down into one opaque `TypeError` with no distinguishing info, so distinguishing them client-side is not achievable, not merely unimplemented. The one failure mode that *is* distinguishable is a malformed host URL, and that's now caught up front with a specific message via `new URL(h)` before the request fires. Closure check: the `try { new URL(h) } catch` guard rejects an unparseable host with a distinct message; client build green. The rest of the reviewer's split is documented here as not-client-detectable rather than left as an open TODO. Landed in e0c3f08.

---

A bare `catch { setError('Could not reach relay...') }` gives identical text for a CORS rejection, a malformed host, DNS failure, or genuine network-down — each needing a different fix, none distinguishable to the user.

**N10. Control-plane messages have no schema validation — a malformed field can crash the whole board daemon** — `server/board/board.js:116-166` · confidence 35

**Status:** ✅ Resolved in 8e664dc — see below.
**Resolution:** Accepted as framed (verdict A), fixed at the dispatch boundary rather than by adding a full schema layer. The `data` listener now wraps `handle(m, sock)` in try/catch and logs a `handle error for cmd <cmd>` on a throw, so a malformed field (e.g. `id` as an object/array, `args` as a non-array) can no longer throw uncaught inside the connection handler and take down the daemon — and every live line with it. Chose the guard over per-command schemas because under the accepted single-user trust model this is a self-inflicted availability gap, not a boundary exploit, and the guard covers all commands including future ones. Closure check: runtime test (isolated board) fires `{cmd:'resize', id:{}}` and `{cmd:'end', id:[]}` and confirms the board stays responsive (subsequent `list` returns, the pre-existing line survives). Landed in 8e664dc.

---

`handle(m, sock)` has no try/catch around it in the `data` listener; a field that doesn't match the implicit assumed shape (e.g. `args` as a non-array) can throw uncaught inside the connection handler, taking down every active line on the board, not just the offending caller's request. Not a boundary-crossing exploit under the accepted single-user trust model, but a self-inflicted availability gap.

**N11. Operator-entered "Relay host" only governs the initial login probe — all real traffic (session CRUD, WS/PTY I/O) always targets `location.host`/same-origin** — `client/src/api.js:1` + `client/src/screens/TerminalScreen.jsx:58-60` · confidence 70

**Status:** ⏸ Deferred — see [issue doc](../../issues/2026-07-01-relay-host-only-governs-login.md).
**Resolution:** Recommended verdict **D** (park). This is a topology/product decision, not a bug: either the host field *should* be honored for all traffic (making the SPA a true remote client of an arbitrary relay — a deployment-model change touching `api.js`, `useSessionWS`, CORS, and the token-exfil surface) or it should be removed/relabelled to reflect that only same-origin is supported. Both are legitimate directions; impact today is low (SPA and backend are same-origin in the shipped model). Guessing the direction unattended would either embed a large architecture change or delete a field the user may want. Parked with an issue doc capturing both options and the interaction with the login-probe host-trust gating already added.

---

A trust-boundary mismatch between what the UI displays (`hostLabel`, the typed host) and where the token is actually sent for every request after the one-time login fetch. Low real-world impact today since the SPA and its backend are typically the same origin in this tool's deployment model, but worth knowing if that topology ever changes.

**N12. No HTTPS enforcement on a non-localhost relay host** — `client/src/screens/LoginScreen.jsx:10,79` · confidence 40

**Status:** ✅ Resolved in 4ba2077 — see below.
**Resolution:** Accepted as framed (verdict A). `connect()` now detects a token being sent to a non-localhost host over plain `http://` and folds a cleartext warning into the same confirm-with-a-second-click gate added for W1: the operator sees "`<host>` is not https:// — your access token would be sent to a remote host in cleartext" and must click Connect again to proceed (or switch to https). Localhost over http is unaffected (token can't leave the machine). Closure check: the `cleartext` predicate (`token && !isLocalhost(h) && /^http:\/\//i.test(h)`) is true for an http remote with a token, false for https, localhost, or no token; client build green. Landed in 4ba2077.

---

The default is `http://localhost:3017` and nothing warns if a non-localhost host is entered without `https://` — a token typed for a real remote host would be sent in cleartext with no indication.

**N13. `checkToken` uses a non-constant-time string comparison** — `server/src/auth.js:5` · confidence 30

**Status:** ✅ Resolved in 8e664dc — see below.
**Resolution:** Accepted as framed (verdict A). `checkToken` now compares via a `safeEqual` helper using `crypto.timingSafeEqual` over `Buffer`s, with a length check first (which leaks only the token length, not its bytes) and a non-string guard. Replaces the `candidate === TOKEN` short-circuit that leaked byte-position timing. Closure check: assertions confirm the correct token accepts, a different-length wrong token and a same-length wrong token both reject, and `undefined`/`null` reject without throwing. Landed in 8e664dc.

---

`candidate === TOKEN` is a timing side-channel in theory; genuinely low severity since exploiting it needs many low-jitter round-trips over a real network path, which is hard in practice. Cheap to harden given this token is described as the sole gate once the port is exposed via a tunnel.

**N14. `cors()` is called with no origin allowlist, reflecting any origin back on every `/api` route** — `server/index.js:12` · confidence 55

**Status:** ✅ Resolved in 4ba2077 — see below.
**Resolution:** Accepted as framed (verdict A). Added an optional `AR_CORS_ORIGIN` env var (comma-separated origins): when set, `cors()` is configured with that allowlist; when unset it keeps the reflect-any-origin default, so the shipped same-origin localhost deployment is unchanged while the tunneled scenario the finding names gets a real restriction knob. Chose a config default over a hardcoded allowlist because the correct origin(s) are deployment-specific. Closure check: the allowlist parser (`split(',').map(trim).filter(Boolean)`) yields the expected array; server syntax-checked. Landed in 4ba2077.

---

Matters most once the port is tunneled (the scenario this repo's own known-issues doc names as the trigger for taking the token seriously): any page the operator's browser visits can issue cross-origin fetches to the exposed origin, and if `AR_TOKEN` is unset, a blind cross-origin POST could spawn a PTY with no token at all, purely because CORS doesn't block it.

**N15. `switchboard_send_input` has no bracketed-paste protection for embedded newlines** — `server/board/mcp-server.js:69-78` · confidence 35

**Status:** ⏸ Deferred — see [issue doc](../../issues/2026-07-01-send-input-bracketed-paste.md).
**Resolution:** Recommended verdict **D** (park). Whether multi-line input should *submit each line* (run a command sequence — today's behavior) or *paste one block* is a genuine product/behavior decision, not a clear bug. Bracketed-paste framing also only works when the receiving program has it enabled (which the board can't know), and applying it unconditionally would leave literal `\e[200~` noise in programs that don't — worse than today. Changing the default could silently break callers relying on per-line submission. Parked with an issue doc recommending an explicit opt-in parameter over a default change, and flagging the target-app-support caveat.

---

A multi-line `text` value (a plausible input from the tool's actual LLM-agent caller — e.g. pasting a heredoc) has every embedded `\n`/`\r` interpreted as a separate Enter keystroke by the shell, auto-submitting each line independently rather than pasting one block.

**N16. Initial `run`-command feed has no confirmation the shell actually received it, and stacks a new timer on every PTY output burst** — `server/board/board.js:71-82` · confidence 40

**Status:** ⏸ Deferred — see [issue doc](../../issues/2026-07-01-run-feed-delivery-confirmation.md).
**Resolution:** Recommended verdict **D** (park). The redundant-timer half is, as the finding says, harmless (the `sent` guard no-ops all but one). The reliability half — confirming the shell actually accepted the injected keystrokes and retrying if not — needs a design decision: reliable confirmation means reading the line back for a command echo (fragile across shells/echo settings) or a capped retry-until-observed loop, and a naive retry risks double-running the command. That's judgment beyond the cited scope. Parked with an issue doc covering both the cheap timer cleanup and the harder confirmation design, plus the double-run risk. (The related W9 constant-naming was done in f152040.)

---

Distinct from W9 (which is about the constants being unnamed) — this is about reliability: a fresh `setTimeout(feed, 120)` is scheduled on every `onData` event during a bursty shell startup (harmless due to the `sent` guard, but wasteful), and there's no verification the shell actually accepted the injected keystrokes — a slow-starting shell can silently eat the initial command with no retry or surfaced error.

---

### Summary

Two CRITICAL findings block merge, both rooted in silent failure: **C1** (`mcp-server.js`'s `seen` cursor has no lifecycle — leaks, desyncs across board restarts, and races) and **C2** (`sessions.list()` collapses "board unreachable" into "zero sessions," making every live session look dead during any transient board hiccup). Both were caught independently by two-to-three distinct reviewer lenses, which is the strongest signal in this review that they're real rather than a single reviewer's pet theory. Beyond those, the codebase's biggest recurring pattern is **silent swallowing** — errors caught and turned into empty results/generic messages across the client (`LoginScreen`, `handleCreate`), the web tier (`sessions.list()`, `rpc()` timeouts), and the board (`resize` validation, control-plane parsing) — worth a deliberate pass even outside these two CRITICALs. The client's dead `session.preview` feature (W2) and the three-times-duplicated control-pipe RPC protocol (W7) are the clearest maintainability landmines. Security-wise, nothing rises to CRITICAL under this tool's stated single-user trust model, but W1 (token sent to an unvalidated, `localStorage`-controlled host) is a genuine, not-yet-mitigated credential-exfiltration path worth fixing before this tool is ever used past pure localhost.

### Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| ~~C1~~ | CRITICAL | 80 | MCP `seen` cursor: leaks, desyncs on board restart, races concurrently | ✅ Resolved (1a166d3) |
| ~~C2~~ | CRITICAL | 75 | `sessions.list()` swallows board failures into `[]` — down looks like empty | ✅ Resolved (5ac451f) |
| ~~W1~~ | WARNING | 85 | Login probe sends token to unvalidated, localStorage-controlled host | ✅ Resolved (e4ca986) |
| ~~W2~~ | WARNING | 80 | `session.preview` rendered but never sent by the server — dead feature | ✅ Resolved (0470132) |
| ~~W3~~ | WARNING | 75 | Bearer-header logic duplicated in `LoginScreen` instead of reusing `api.js` | ✅ Resolved (e4ca986) |
| ~~W4~~ | WARNING | 75 | `handleCreate` has no error handling on session-create failure | ✅ Resolved (963d021) |
| ~~W5~~ | WARNING | 75 | Session DTO shape hand-duplicated across `toDto()`/`spawn()` | ✅ Resolved (babe7b7) |
| ~~W6~~ | WARNING | 70 | No Express error handler — leaks stack traces on any board failure | ✅ Resolved (245406e) |
| ~~W7~~ | WARNING | 70 | Control-pipe RPC protocol reimplemented 3x with no shared helper | ✅ Resolved (619c1cd) |
| ~~W8~~ | WARNING | 70 | `POST /sessions` forwards unvalidated body fields into `pty.spawn` | ✅ Resolved (94ac1dc) |
| ~~W9~~ | WARNING | 65 | Unnamed magic timing constants for initial-command feed | ✅ Resolved (f152040) |
| ~~W10~~ | WARNING | 65 | Sessions poll vs kill/create race — stale-list flicker/resurrection | ✅ Resolved (b503aaa) |
| W11 | WARNING | 55 | Named pipes created with no explicit ACL restriction | ⏸ Deferred |
| ~~W12~~ | WARNING | 55 | Unvalidated `resize` cols/rows can wedge a line's size via `NaN` | ✅ Resolved (07db618) |
| ~~W13~~ | WARNING | 55 | Spawned session's `cwd` is client-computed, not board-confirmed | ✅ Resolved (babe7b7) |
| ~~W14~~ | WARNING | 55 | `get()`-then-`attach()` TOCTOU on session existence | ✅ Resolved (37c9267, re-framed) |
| N11 | NOTE | 70 | "Relay host" field is decorative beyond the initial login probe | ⏸ Deferred |
| ~~N2~~ | NOTE | 60 | Initial `run` command logged in plaintext, unrotated | ✅ Resolved (8e664dc) |
| N3 | NOTE | 60 | Scrollback `Array.shift()` is O(n), but bounded and cheap at n=2000 | ✋ Rejected |
| N1 | NOTE | 55 | Root and board autostart scripts are near-identical duplicates | ⏸ Deferred |
| ~~N4~~ | NOTE | 55 | WS `onmessage` has no try/catch — malformed frame freezes terminal silently | ✅ Resolved (c8b19c5) |
| ~~N5~~ | NOTE | 55 | Undocumented ref-tangle coupling `TerminalScreen` to hook internals | ✅ Resolved (c8b19c5) |
| ~~N7~~ | NOTE | 55 | `openPane`'s `{cmd}` substitution silently no-ops on partial-token match | ✅ Resolved (9293398) |
| ~~N14~~ | NOTE | 55 | Bare `cors()` reflects any origin on every `/api` route | ✅ Resolved (4ba2077) |
| ~~N6~~ | NOTE | 50 | `wait.js` exit-code regex hand-coupled to board's exact log string | ✅ Resolved (8e664dc) |
| ~~N8~~ | NOTE | 40 | `rpc()` has no timeout across all three implementations | ✅ Resolved (619c1cd) |
| ~~N9~~ | NOTE | 40 | `LoginScreen` catch-all hides distinguishable failure causes | ✅ Resolved (e0c3f08, re-framed) |
| ~~N10~~ | NOTE | 40 | Control-plane messages unvalidated — malformed field can crash the daemon | ✅ Resolved (8e664dc) |
| ~~N12~~ | NOTE | 40 | No HTTPS enforcement on a non-localhost relay host | ✅ Resolved (4ba2077) |
| N16 | NOTE | 40 | Initial `run` feed has no delivery confirmation, stacks redundant timers | ⏸ Deferred |
| ~~N13~~ | NOTE | 30 | Non-constant-time token comparison | ✅ Resolved (8e664dc) |
| N15 | NOTE | 35 | `switchboard_send_input` has no bracketed-paste protection | ⏸ Deferred |

**What's left:** 26 Resolved · 5 Deferred (W11, N1, N11, N15, N16 — each with an issue doc) · 1 Rejected (N3) · 0 Open. All 32 findings reached a verdict.
