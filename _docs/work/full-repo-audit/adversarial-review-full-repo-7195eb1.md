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

Three independent lenses (Saboteur, Maintainer, Capacity Planner) converged on the same defect from three different angles, which is what promotes this to CRITICAL:

1. **Unbounded growth (Capacity Planner, confidence 75).** The module-level `seen` Map is keyed by line id and populated on every `switchboard_read_output` call (`seen.set(id, text.length)`), but nothing ever calls `seen.delete(id)` — not on line exit, not on `switchboard_end_line`, nowhere. Since this MCP server process is explicitly designed to survive Claude Code session restarts/compaction (per its own tool description), it can run for days, and every distinct line ever read through it leaves a permanent entry.
2. **Silent data corruption after board restart (Saboteur + Maintainer, confidence 70-80).** Line ids come from a process-local counter (`seq` in `board.js:25,28`) that resets to `0` whenever the board restarts — and board restarts are a *designed, expected* occurrence: both `mcp-server.js` and `sb.js` auto-restart the board via `connectControl({autostart:true})` whenever it's down (`lib.js:48-69`). If a fresh line reuses an old id (e.g. `"1"`), it inherits the old `seen` cursor value, and `readOutput`'s `text.slice(already)` silently returns truncated or empty output for the new line's early bytes — no error, just missing output that looks like the tool worked.
3. **Concurrency race (Saboteur, confidence 60).** Each `readOutput` call opens its *own* socket to the line's data pipe and gets its own full scrollback replay, but all concurrent calls for the same id write to the *same* shared `seen` entry unconditionally (`seen.set(id, text.length)`, no max-guard). Two overlapping reads (plausible — an agent double-invoking the tool, or `switchboard_wait_for_idle` racing `switchboard_read_output`) can roll the cursor backward (re-delivering already-returned output) or jump it forward (silently skipping a chunk that's never delivered to anyone).

**Fix:** Key `seen` by a value that can't be reused across board restarts (e.g. combine id with a boot nonce/PID the board hands back), clear the entry on line-exit detection (reuse the `EXIT_RE` sentinel pattern from `wait.js`), and guard concurrent updates with `seen.set(id, Math.max(seen.get(id) ?? 0, text.length))` or a per-id serialization queue.

**C2. `sessions.list()` swallows every board failure into an empty array — "board is down" and "zero sessions exist" are indistinguishable everywhere in the web tier** — `server/src/sessions.js:44-46` · confidence 75

Two distinct lenses converged here: the Saboteur (confidence 80) flagged the reliability failure mode, the Maintainer (confidence 70) independently flagged the silent-swallow-with-no-log debuggability problem.

`list()` does `const r = await rpc({cmd:'list'}).catch(() => null); return r && r.ok ? r.lines.map(toDto) : [];` — any RPC failure (board not running, pipe error, malformed reply) produces the same `[]` as a genuinely empty session list. This propagates two ways: `GET /api/sessions` returns a 200 with `[]` (the UI shows "no sessions yet" instead of any error), and — more seriously — `ws.js:15` calls `sessions.get(id)` (which calls `list()` internally) to validate a session exists *before* attaching. During any board hiccup (a restart is a normal, autostart-triggered event per C1's context, and per CLAUDE.md any change to `server/board/*` requires a full board restart), **every single active session becomes unattachable** — every WebSocket connection attempt gets closed with `1008, 'session not found'`, even for lines that are still perfectly alive on the board once it comes back — with zero log line or diagnostic signal anywhere in the stack. For a tool whose entire purpose is maintaining continuous terminal access, "every session looks dead during a transient, self-healing condition, and there's no way to tell that from the sessions actually being gone" is a severe, silent reliability failure.

**Fix:** Let `list()` propagate a distinguishable failure (throw, or a sentinel distinct from `[]`) instead of swallowing to empty; have `api.js` return 503 and `ws.js` use a distinct close code/reason for "board unreachable" vs "session not found"; log the swallowed error at minimum.

---

### Warnings

**W1. Login probe sends the real access token to an attacker-controllable host with zero validation** — `client/src/screens/LoginScreen.jsx:9-28` · confidence 85

The "Relay host" field is seeded from `localStorage.getItem('ar-host')` with no check that it matches a previously-trusted value, and `connect()` immediately sends the typed token as a Bearer header to whatever origin that resolves to — before any confirmation the host is legitimate. If an attacker can get `ar-host` pre-set to an attacker-controlled origin (a crafted link/QR code that runs a one-time script, a malicious extension, a shared machine), the next time the operator types their real token and clicks Connect, the token goes straight to the attacker's server on the very first request, with no visible warning that the host differs from what the operator expects.

**Fix:** Warn visibly when the current host input differs from the last-successfully-connected host (or isn't localhost) before the Connect button fires the request carrying the token.

**W2. `SessionCard`/`TerminalPreview` renders a field the server never sends — the output-preview feature is entirely dead** — `client/src/screens/SessionsScreen.jsx:13,61` + `server/src/sessions.js:30-40,63-71` · confidence 80

`TerminalPreview` renders `session.preview.slice(-4)`, but neither `toDto()` nor `spawn()` in `sessions.js` ever populates a `preview` key — the DTO only carries id/name/shell/cwd/pid/status/lastActive. Every card permanently shows "no output yet." This reads as a working feature; a future maintainer will spend real time hunting for where preview data is supposed to come from before discovering the server-side wiring was never built (the board does keep a 2000-chunk scrollback per line, so the data exists one layer down).

**Fix:** Wire an actual scrollback-tail through `BoardSessions.list()`/`toDto()`, or remove the dead UI and file it as a known TODO.

**W3. Bearer-header construction is duplicated ad hoc in `LoginScreen` instead of reusing `api.js`'s `headers()`** — `client/src/screens/LoginScreen.jsx:22-24` · confidence 75

`api.js` centralizes the guarded `Authorization: Bearer ${token}` pattern in `headers(token)`, but `LoginScreen.connect()` reimplements the identical expression inline. If the auth scheme ever changes, a maintainer fixing `api.js` has no signal `LoginScreen` needs the same edit, and grepping for `headers(` won't surface the second copy.

**Fix:** Export `headers()` (or a `probeConnection(host, token)` helper) from `api.js` and have `LoginScreen` call it.

**W4. `handleCreate` has no error handling — a failed session create silently closes the dialog with no feedback** — `client/src/screens/SessionsScreen.jsx:186-190` · confidence 75

`setDialog(false)` fires immediately, then `await createSession(opts, token)` with no try/catch; `createSession` throws on any non-ok response (expired token, 500, network drop). The rejection becomes an unhandled promise rejection — the dialog vanishes, no session is created, and the user sees nothing. Every other fetch call site in this app (`LoginScreen.connect`, `SessionsScreen.load`) wraps its call in try/catch; this is the one that doesn't.

**Fix:** Wrap in try/catch; on failure, reopen the dialog and show an error message consistent with `LoginScreen`'s pattern.

**W5. Session DTO shape is hand-duplicated across `toDto()` and `spawn()` and can silently drift** — `server/src/sessions.js:30-40,63-71` · confidence 75

`toDto(line)` is the documented single mapping from a board "line" to the session DTO, but `spawn()` doesn't call it — it hand-builds an equivalent object, because the board's `new` RPC reply (`board.js:122`) only echoes `{id, pid, shell, name, dataPipe}`, missing `cwd`/`idleMs`. That constraint isn't documented at either call site, so a future field addition to `toDto()` won't automatically appear on a just-spawned session until the next `list()` poll, with nothing enforcing the two stay in sync.

**Fix:** Comment the constraint at `spawn()`'s return, or have the board's `new` handler echo the same shape as its `list` entries so `toDto()` can be shared.

**W6. Express has no custom error handler — RPC/board failures leak internal stack traces in HTTP responses** — `server/index.js:11-19` (missing) + `server/src/api.js` (all routes `next(e)`) · confidence 70

Every route forwards errors via `next(e)`, and `index.js` never installs error-handling middleware, so Express's default handler applies — which includes the full stack trace in the response body whenever `NODE_ENV` isn't `production` (the default here, since it's never set). Any board-client failure (pipe error, malformed reply, a `pty.spawn` throw) becomes a 500 response leaking internal file paths and stack frames to anyone who can reach `/api` — which, per the AR_TOKEN-unset case, may be anyone.

**Fix:** Install a final error-handling middleware that logs server-side and returns a generic `{error: 'internal error'}` with no message/stack.

**W7. The board's control-pipe RPC protocol is independently reimplemented three times across the codebase, with no shared helper** — `server/board/sb.js:19-31`, `server/board/mcp-server.js:15-28`, `server/src/board-client.js:10-23` · confidence 70

A seam-crossing finding: the board-slice Maintainer flagged the `sb.js`/`mcp-server.js` pair as duplicated ~15-line "write one JSON line, read one JSON line back" implementations; the web-tier Maintainer independently flagged `board-client.js`'s copy of the identical pattern and its lack of a timeout, noting the risk of the three copies drifting. All three exist because `lib.js` (which every one of them already imports for `connectControl`/`connectPipe`) doesn't also own the request/response framing. A future protocol change (a timeout, a different framing scheme) has three call sites to update, with nothing signaling they're linked — and one already lacks a timeout while the others might independently grow one, exactly the drift the maintainers warned about.

**Fix:** Extract one `rpc(msg, opts)` into `lib.js`, imported by all three.

**W8. `POST /sessions` forwards `req.body` fields to `pty.spawn` with zero validation** — `server/src/api.js:13-18` · confidence 70

`name`/`cwd`/`shell`/`command` are destructured with no type/shape/length checks before reaching `sessions.spawn` → the board's `pty.spawn`. A non-string field (e.g. `cwd` as an array) throws inside `resolveCwd`'s `.trim()` before the route's own try/catch cleanly applies, producing an opaque 500. There's also no length cap — a client with a valid token can send a multi-MB `command` that gets typed into a real shell via the board's `run` field.

**Fix:** Validate string type and a sane length for all four fields; return 400 on violation instead of falling through to `pty.spawn`.

**W9. Magic timing constants for the initial-command feed have no named constants or shared rationale** — `server/board/board.js:74-81` · confidence 65

The `120ms`/`1500ms` values driving the `run`-field keystroke injection are bare numeric literals with only a prose comment explaining ConPTY's keystroke-drop behavior. A future maintainer tuning shell-startup latency has to re-derive which number means what from the comment alone, with no single source of truth if the logic needs touching in more than one place later.

**Fix:** Hoist to named constants (`FEED_DEBOUNCE_MS`, `FEED_FALLBACK_MS`) at module scope.

**W10. `SessionsScreen`'s 5s poll and in-flight kill/create requests aren't sequenced — stale responses can resurrect or flicker a just-killed session** — `client/src/screens/SessionsScreen.jsx:180-195` · confidence 65

The poll interval and `handleKill`'s optimistic local filter run independently with no in-flight guard on `load()`. Walk it through: kill session X fires; before the DELETE resolves, the next poll tick's `load()` returns the server list still containing X and overwrites state; when the DELETE then resolves, `prev.filter(...)` removes X again — but if a second poll interleaves in between, X can flicker back into view for up to another 5s cycle. More generally, overlapping `load()` calls have no ordering guarantee, so an older response can stomp a newer one.

**Fix:** Guard `load()` against overlapping calls (in-flight ref or `AbortController`), and have `handleKill` either skip the next poll tick or merge the kill into whatever the poll returns rather than relying on stale `prev`.

**W11. Named pipes are created with no explicit ACL restriction** — `server/board/board.js:51,196` · confidence 55

Both the control pipe and every per-line data pipe call bare `net.Server.listen(pipePath)` with no explicit Windows security descriptor. Node exposes ACL-related listen options specifically because libuv's default named-pipe DACL is not guaranteed to be scoped to the creating user/session — this is a plausible, checkable gap (not independently verified live with `icacls`/AccessChk in this pass) that would upgrade the documented "board has no auth, trust the local user" design from accepted-by-design to a concrete escalation if the actual DACL is broader than same-user.

**Fix:** Verify the effective DACL with `icacls \\.\pipe\agent-relay` while the board is running; if broader than the creating user, apply an explicit restrictive security descriptor.

**W12. `resize` control messages trust unvalidated `cols`/`rows` into `Math.min`/`pty.resize`, which can wedge a line's size on garbage input** — `server/board/board.js:151-154,91-96` · confidence 55

The `resize` handler stores `{cols: m.cols, rows: m.rows}` straight from parsed JSON with no type check; `applyMin` folds all sizes via `Math.min` starting from `Infinity`. A non-numeric value (`{cols:"x", rows:null}`) propagates `NaN` through every subsequent `applyMin` call on that line — every pane's resize breaks — until the poisoned client disconnects. The surrounding `try/catch` silently swallows whatever `node-pty` does with `resize(NaN, NaN)`. Not reachable via the intended client (`patch.js` always sends real numbers), but the control pipe has no schema validation anywhere and is reachable by any local process per the documented trust model.

**Fix:** Validate `cols`/`rows` are finite positive integers before storing/using them.

**W13. `spawn()`'s returned `cwd` is the client's own `resolveCwd()` output, not an echo of what the board actually used** — `server/src/sessions.js:52-71` · confidence 55

Today these coincide because `resolveCwd` is a pure deterministic transform, but the board never echoes back the `cwd` it actually recorded (`board.js:39` stores it as received, with no confirmation in the `new` reply). If the two ever diverge (board-side normalization, a spawn fallback), the DTO would silently misreport where the shell launched, with no round-trip validation catching it.

**Fix:** Have the board's `new` reply echo the resolved `cwd` it used, matching the `list` reply's shape.

**W14. `sessions.get(id)` then `sessions.attach(id)` is a TOCTOU: a session can be killed between the existence check and the attach** — `server/src/ws.js:15,24` + `server/src/sessions.js:48-50` · confidence 55

Two overlapping lenses (Maintainer, Security) independently described the same race, so this is reported once rather than promoted (they weren't materially distinct fears). `get()` round-trips a full `list()` to check existence, then a separate `attach()` RPC follows; a session killed in that window isn't caught by a clean "not found" path — it falls through to the generic `catch { ws.close(1011, 'attach failed') }`, a confusing close reason for what is really "the session just ended."

**Fix:** Have the board expose a direct by-id existence/attach path so the check and the attach aren't two independent round-trips.

---

### Notes

**N1. Root and board-daemon autostart scripts are near-identical, hand-duplicated PowerShell** — `autostart.ps1` (repo root) vs `server/board/autostart.ps1` · confidence 55

Same structure (install/uninstall/status against a Scheduled Task, differing only by `$TaskName`/target `.vbs`) — a bug fix in one (e.g. the `CimException` handling) has no reason to remind a maintainer the sibling copy needs the same fix.

**N2. Initial `run` command text is logged in plaintext to a persistent, unrotated log file** — `server/board/board.js:81` · confidence 60

`log('line', id, 'will run:', run)` writes the full command text to `switchboard.log` next to `board.js`, with no rotation or redaction. A command embedding a credential as an argv (e.g. `--api-key=...`) lands in plaintext indefinitely.

**N3. `board.js`'s scrollback array uses `Array.shift()` — O(n) per PTY event, but bounded at n=2000 so the realistic cost is small** — `server/board/board.js:56-57` · confidence 60

Correctly classified as O(n)-per-chunk by the Capacity Planner, but at the documented `SCROLLBACK=2000` cap and this tool's realistic concurrency (single-digit lines, 1-3 clients each), each shift is a cheap microsecond-scale memmove — not worth fixing pre-emptively; a ring buffer would make it O(1) if this ever needs tightening.

**N4. `useSessionWS`'s `onmessage` has no try/catch — a malformed WS frame throws silently and freezes the terminal with no reconnect** — `client/src/screens/TerminalScreen.jsx:70-74` · confidence 55

`JSON.parse(e.data)` assumes every frame is valid JSON. Browsers don't close the socket or fire `onerror`/`onclose` on a handler exception — the connection looks "online" but stops receiving further output, and the existing reconnect logic never engages because nothing marks it unhealthy.

**N5. Four refs in `TerminalScreen` exist solely to satisfy `useSessionWS`'s exhaustive-deps opt-out, with no comment connecting the two** — `client/src/screens/TerminalScreen.jsx:120-136` (refs) / `44-100` (hook) · confidence 55

`onDataRef`/`onExitRef`/`refitRef`/`onBackRef` all exist because the hook's socket effect intentionally excludes its callbacks from its dependency array (stated in a two-line comment inside the hook). Nothing at the ref declarations in the component points back to that contract, so a maintainer sees four refs where a normal component would have zero, with no explanation co-located.

**N6. `wait.js`'s exit-code regex is hand-coupled to `board.js`'s exact farewell string with no shared constant** — `server/board/wait.js:11` + `server/board/board.js:61` · confidence 50

A future wording change to the board's exit sentinel silently breaks `wait.js`'s exit-code detection (`exitCode: null` forever) with no compiler/runtime error — the comment flags it as a sentinel but the string itself isn't shared.

**N7. `openPane`'s `{cmd}` token substitution silently no-ops if the token isn't its own array element** — `server/board/board.js:106` · confidence 55

Substitution only matches an argv element exactly equal to `{cmd}`; a hand-written `SWITCHBOARD_TERM` embedding the token inside a larger string (e.g. `"sh -c '{cmd}'"`) leaves it untouched, and the pane spawns with the literal wrong argv — silently, since `openPane`'s error handler only catches ENOENT-class failures, not "ran with wrong args."

**N8. `rpc()` (all three copies) has no timeout — a hung board leaves the caller waiting forever** — `server/src/board-client.js:10-23` (and its `sb.js`/`mcp-server.js` siblings, see W7) · confidence 40

If the board accepts the connection but never writes a response, the promise never settles — no client-visible timeout on the HTTP/CLI/MCP side.

**N9. `LoginScreen`'s catch-all collapses distinguishable failure modes into one generic message** — `client/src/screens/LoginScreen.jsx:21-33` · confidence 40

A bare `catch { setError('Could not reach relay...') }` gives identical text for a CORS rejection, a malformed host, DNS failure, or genuine network-down — each needing a different fix, none distinguishable to the user.

**N10. Control-plane messages have no schema validation — a malformed field can crash the whole board daemon** — `server/board/board.js:116-166` · confidence 35

`handle(m, sock)` has no try/catch around it in the `data` listener; a field that doesn't match the implicit assumed shape (e.g. `args` as a non-array) can throw uncaught inside the connection handler, taking down every active line on the board, not just the offending caller's request. Not a boundary-crossing exploit under the accepted single-user trust model, but a self-inflicted availability gap.

**N11. Operator-entered "Relay host" only governs the initial login probe — all real traffic (session CRUD, WS/PTY I/O) always targets `location.host`/same-origin** — `client/src/api.js:1` + `client/src/screens/TerminalScreen.jsx:58-60` · confidence 70

A trust-boundary mismatch between what the UI displays (`hostLabel`, the typed host) and where the token is actually sent for every request after the one-time login fetch. Low real-world impact today since the SPA and its backend are typically the same origin in this tool's deployment model, but worth knowing if that topology ever changes.

**N12. No HTTPS enforcement on a non-localhost relay host** — `client/src/screens/LoginScreen.jsx:10,79` · confidence 40

The default is `http://localhost:3017` and nothing warns if a non-localhost host is entered without `https://` — a token typed for a real remote host would be sent in cleartext with no indication.

**N13. `checkToken` uses a non-constant-time string comparison** — `server/src/auth.js:5` · confidence 30

`candidate === TOKEN` is a timing side-channel in theory; genuinely low severity since exploiting it needs many low-jitter round-trips over a real network path, which is hard in practice. Cheap to harden given this token is described as the sole gate once the port is exposed via a tunnel.

**N14. `cors()` is called with no origin allowlist, reflecting any origin back on every `/api` route** — `server/index.js:12` · confidence 55

Matters most once the port is tunneled (the scenario this repo's own known-issues doc names as the trigger for taking the token seriously): any page the operator's browser visits can issue cross-origin fetches to the exposed origin, and if `AR_TOKEN` is unset, a blind cross-origin POST could spawn a PTY with no token at all, purely because CORS doesn't block it.

**N15. `switchboard_send_input` has no bracketed-paste protection for embedded newlines** — `server/board/mcp-server.js:69-78` · confidence 35

A multi-line `text` value (a plausible input from the tool's actual LLM-agent caller — e.g. pasting a heredoc) has every embedded `\n`/`\r` interpreted as a separate Enter keystroke by the shell, auto-submitting each line independently rather than pasting one block.

**N16. Initial `run`-command feed has no confirmation the shell actually received it, and stacks a new timer on every PTY output burst** — `server/board/board.js:71-82` · confidence 40

Distinct from W9 (which is about the constants being unnamed) — this is about reliability: a fresh `setTimeout(feed, 120)` is scheduled on every `onData` event during a bursty shell startup (harmless due to the `sent` guard, but wasteful), and there's no verification the shell actually accepted the injected keystrokes — a slow-starting shell can silently eat the initial command with no retry or surfaced error.

---

### Summary

Two CRITICAL findings block merge, both rooted in silent failure: **C1** (`mcp-server.js`'s `seen` cursor has no lifecycle — leaks, desyncs across board restarts, and races) and **C2** (`sessions.list()` collapses "board unreachable" into "zero sessions," making every live session look dead during any transient board hiccup). Both were caught independently by two-to-three distinct reviewer lenses, which is the strongest signal in this review that they're real rather than a single reviewer's pet theory. Beyond those, the codebase's biggest recurring pattern is **silent swallowing** — errors caught and turned into empty results/generic messages across the client (`LoginScreen`, `handleCreate`), the web tier (`sessions.list()`, `rpc()` timeouts), and the board (`resize` validation, control-plane parsing) — worth a deliberate pass even outside these two CRITICALs. The client's dead `session.preview` feature (W2) and the three-times-duplicated control-pipe RPC protocol (W7) are the clearest maintainability landmines. Security-wise, nothing rises to CRITICAL under this tool's stated single-user trust model, but W1 (token sent to an unvalidated, `localStorage`-controlled host) is a genuine, not-yet-mitigated credential-exfiltration path worth fixing before this tool is ever used past pure localhost.

### Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| C1 | CRITICAL | 80 | MCP `seen` cursor: leaks, desyncs on board restart, races concurrently | (open) |
| C2 | CRITICAL | 75 | `sessions.list()` swallows board failures into `[]` — down looks like empty | (open) |
| W1 | WARNING | 85 | Login probe sends token to unvalidated, localStorage-controlled host | (open) |
| W2 | WARNING | 80 | `session.preview` rendered but never sent by the server — dead feature | (open) |
| W3 | WARNING | 75 | Bearer-header logic duplicated in `LoginScreen` instead of reusing `api.js` | (open) |
| W4 | WARNING | 75 | `handleCreate` has no error handling on session-create failure | (open) |
| W5 | WARNING | 75 | Session DTO shape hand-duplicated across `toDto()`/`spawn()` | (open) |
| W6 | WARNING | 70 | No Express error handler — leaks stack traces on any board failure | (open) |
| W7 | WARNING | 70 | Control-pipe RPC protocol reimplemented 3x with no shared helper | (open) |
| W8 | WARNING | 70 | `POST /sessions` forwards unvalidated body fields into `pty.spawn` | (open) |
| W9 | WARNING | 65 | Unnamed magic timing constants for initial-command feed | (open) |
| W10 | WARNING | 65 | Sessions poll vs kill/create race — stale-list flicker/resurrection | (open) |
| W11 | WARNING | 55 | Named pipes created with no explicit ACL restriction | (open) |
| W12 | WARNING | 55 | Unvalidated `resize` cols/rows can wedge a line's size via `NaN` | (open) |
| W13 | WARNING | 55 | Spawned session's `cwd` is client-computed, not board-confirmed | (open) |
| W14 | WARNING | 55 | `get()`-then-`attach()` TOCTOU on session existence | (open) |
| N11 | NOTE | 70 | "Relay host" field is decorative beyond the initial login probe | (open) |
| N2 | NOTE | 60 | Initial `run` command logged in plaintext, unrotated | (open) |
| N3 | NOTE | 60 | Scrollback `Array.shift()` is O(n), but bounded and cheap at n=2000 | (open) |
| N1 | NOTE | 55 | Root and board autostart scripts are near-identical duplicates | (open) |
| N4 | NOTE | 55 | WS `onmessage` has no try/catch — malformed frame freezes terminal silently | (open) |
| N5 | NOTE | 55 | Undocumented ref-tangle coupling `TerminalScreen` to hook internals | (open) |
| N7 | NOTE | 55 | `openPane`'s `{cmd}` substitution silently no-ops on partial-token match | (open) |
| N14 | NOTE | 55 | Bare `cors()` reflects any origin on every `/api` route | (open) |
| N6 | NOTE | 50 | `wait.js` exit-code regex hand-coupled to board's exact log string | (open) |
| N8 | NOTE | 40 | `rpc()` has no timeout across all three implementations | (open) |
| N9 | NOTE | 40 | `LoginScreen` catch-all hides distinguishable failure causes | (open) |
| N10 | NOTE | 40 | Control-plane messages unvalidated — malformed field can crash the daemon | (open) |
| N12 | NOTE | 40 | No HTTPS enforcement on a non-localhost relay host | (open) |
| N16 | NOTE | 40 | Initial `run` feed has no delivery confirmation, stacks redundant timers | (open) |
| N13 | NOTE | 30 | Non-constant-time token comparison | (open) |
| N15 | NOTE | 35 | `switchboard_send_input` has no bracketed-paste protection | (open) |
