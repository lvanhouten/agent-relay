## Adversarial Review: full-repo audit — PRs #13-#18 (secure defaults, named-pipe access secret, same-origin login, run-feed confirmation, bracketed paste, autostart dedup)

**Scope:** 6 squash-merged PRs, 27 files changed (~19 non-doc code files), 819 insertions / 250 deletions. Core security surface: `server/src/auth.js`, `server/src/origin.js` (new), `server/src/ws.js`, `server/index.js`, `server/src/api.js`, `server/board/board.js`, `server/board/lib.js`, `server/board/mcp-server.js`, `client/src/hostTrust.js`, `client/src/screens/LoginScreen.jsx`, plus a PowerShell autostart-script dedup (`autostart-task.ps1`, `autostart.ps1`, `server/board/autostart.ps1`).
**Reviewed:** `9e35ffa..82b61ae` (main). All 61 server tests pass at HEAD.
**Verdict:** BLOCK — 2 CRITICAL findings. This range is already merged to `main`; treat this as "patch immediately," not "hold the merge."

Method: full-file reads (not diff hunks) by the orchestrator, cross-checked against three independent, isolated persona subagents (Saboteur, Maintainer, Security Auditor — the Security pass run on Opus given the security-heavy surface) that were each blind to the other two and were explicitly instructed **not** to trust the `_docs/issues/*.md` resolution notes' self-reported "verified end-to-end" claims. Findings below are the orchestrator's own synthesis after grounding-checking every persona claim against the actual code.

### Critical Findings

**C1. Control-plane pipe has no pre/post-auth buffer cap — unbounded memory growth and a full daemon crash, reachable by exactly the threat actor this PR targets** — `server/board/board.js:337-362` (vs. the capped sibling at `server/board/board.js:138-158`, cap at line 146) · confidence 85

Independently flagged by **all three personas** (Maintainer, Security Auditor, and Saboteur), each via a different angle — genuine distinct-lens convergence, promoted to CRITICAL.

The data-plane socket handler (`createLine`'s `net.createServer`, board.js:138) explicitly caps its pre-auth accumulator: `if (authBuf.length > 4096) sock.destroy();` (line 146), with a comment citing memory as the reason. The control-plane's `board` server (board.js:337) does `buf += chunk` (line 342) with **no equivalent cap**, either before or after auth succeeds. `while ((i = buf.indexOf('\n')) >= 0)` never fires without a `\n`, so a connection that streams bytes with no newline grows `buf` without bound for the full `AUTH_TIMEOUT_MS` (5000ms) window before the pre-auth timer destroys the socket — and post-auth, an oversized single JSON "line" has the same unbounded growth with no timeout backstop at all.

This matters more than an ordinary DoS because of what happens when the string actually grows too large: V8 caps string length (~512MB); exceeding it throws a `RangeError` synchronously inside the `sock.on('data', ...)` listener. There is **no `process.on('uncaughtException')` handler anywhere in the board daemon** (verified: `grep -rn "uncaughtException" server/board/` returns nothing), so that throw is fatal to the whole process — killing every live line the board owns, including any attached agent session, not just the offending connection.

The attacker profile is exactly the one this entire PR range exists to defend against: any other local OS user account (or a buggy same-user script) that can open the control pipe under the OS default DACL (per `_docs/issues/2026-07-01-named-pipe-dacl-verification.md`'s own verified-read-access finding) can trigger this pre-auth, without ever needing to know the secret.

**Fix:** apply the same 4096-byte (or similar) cap used on the data plane to the control-plane's `buf`, both pre- and post-auth (a legitimate single JSON command line has no reason to be unbounded either).

---

**C2. Concurrent cold-start board launches can permanently desync the on-disk secret file from the surviving daemon's in-memory secret, locking out every client** — `server/board/board.js:381-386` (write-then-listen ordering) + `server/board/lib.js:122-144` (`connectControl`'s per-call `started` flag) · confidence 68

Found by the Saboteur persona; independently confirmed by the orchestrator against the full text of both files.

`connectControl()` tracks autostart eligibility in a **local closure variable** (`let started = false;`, lib.js:124), scoped to that one call. If two independent callers hit a cold board at nearly the same moment (two `sb` invocations, an MCP tool call racing a web request at session start, autostart's VBS launcher racing a client that starts before it — all plausible given the architecture explicitly supports "multiple same-user local consumers" attaching concurrently), each gets a connection failure, and **each independently calls `startBoard()`**, spawning two separate `node board.js` processes with no lock or mutex between them.

Each process runs the daemon-entry block unconditionally: `SECRET = writeBootSecret(); board.listen(CTRL, ...)` (board.js:381-386) — `writeBootSecret()` overwrites the shared secret file on disk **synchronously, before** `listen()` is even attempted. Whichever process loses the `listen()` race gets `EADDRINUSE` and exits (board.js:372-374's handler just logs and calls `process.exit(0)` — it never restores the secret file). If the loser's `writeBootSecret()` call lands after the winner's `listen()` has already succeeded — a real possibility given both writes are unsynchronized disk I/O in racing OS processes — the file on disk now holds the loser's secret while the surviving daemon holds the winner's secret in memory.

Every subsequent client calls `readSecret()` fresh, uncached, per connect (lib.js:95-98) — so from that point on, **every single client connection presents the wrong secret** and is destroyed by `secretEqual`, for both the control and every data pipe, until an operator manually deletes the secret file or restarts the board. This is a total, self-inflicted lockout of the tool with no automatic recovery path, triggered by ordinary concurrent use rather than by an attacker.

**Fix:** serialize the write-then-listen sequence — e.g. attempt `listen()` first and only call `writeBootSecret()` after a successful bind (so a losing process never touches the file), or wrap the whole startup sequence in an exclusive lock (lockfile / named mutex) keyed off `PIPE_BASE`.

### Warnings

**W1. Windows secret-file permission bits are a no-op; the real confidentiality boundary was never verified with the same rigor as the pipe DACL** — `server/board/lib.js:44-45` · confidence 58

`writeBootSecret` passes `{ mode: 0o700 }` / `{ mode: 0o600 }` to `fs.mkdirSync`/`fs.writeFileSync` unconditionally on every platform. On Windows, Node's `mode` option does not set an NTFS ACL — it has no meaningful effect on who can read the file (well-documented Node/Windows behavior). So the entire real protection for the plaintext secret is whatever ACL `%LOCALAPPDATA%\agent-relay\` *inherits* from the user profile directory — an assumption stated in the lib.js:28-33 comment ("NTFS already denies other non-admin users traversal into another profile") but never live-tested. Contrast this with the pipe DACL, which the same PR range's own issue doc (`2026-07-01-named-pipe-dacl-verification.md`) verified with a live `.GetAccessControl()` probe before shipping the fix. The secret file — the thing that now *is* the security boundary — got no equivalent probe. If the inherited directory ACL is ever broader than the creating user (roaming/redirected profiles, a loosened AppData ACL, a sync/backup agent), a foreign local user reads the secret straight from disk and fully reopens the exact vulnerability (PTY-output disclosure, and via the control pipe, command dispatch) this PR claims to close — just via file read instead of pipe read. POSIX has a lesser version of the same gap: `mode` only applies at file-creation time, so a pre-existing `~/.agent-relay` directory with wider permissions is never retroactively tightened.

**Fix:** verify the effective ACL on the secret file/directory with a live probe the way the pipe DACL was verified, and/or explicitly reset the file's ACL post-creation on Windows (e.g. `icacls /inheritance:r` granting only the current user + SYSTEM/Administrators) rather than relying on inheritance.

---

**W2. Duplicated auth-handshake and constant-time-compare logic is the root cause that let C1 happen — and will let it happen again** — `server/board/board.js:138-158` vs `server/board/board.js:337-362`; `server/board/lib.js:59-64` (`secretEqual`) vs `server/src/auth.js:21-27` (`safeEqual`) · confidence 70

Flagged by the Maintainer persona; confirmed by the orchestrator. The data-plane and control-plane `net.createServer` callbacks in `board.js` each independently hand-roll the identical handshake shape: accumulate bytes into a local buffer, find the first `\n`, strip a trailing `\r`, compare via `secretEqual`, flip an `authed` flag, clear an `authTimer`. C1 is the direct, observed consequence of this duplication — a hardening detail (the buffer cap) landed in one copy and was never carried to its twin, in the *same commit*. Separately, `secretEqual` (lib.js) and `safeEqual` (auth.js) are two independent implementations of the same constant-time compare, living in different modules with no shared import or cross-reference (lib.js's comment says "mirrors src/auth.js"; auth.js has no reciprocal pointer). They are logically equivalent today, but nothing keeps them that way.

**Fix:** factor the shared handshake (accumulate-until-newline, strip `\r`, `secretEqual` compare, `authTimer`, buffer cap) into one helper in `lib.js` that both `createServer` callbacks call, the same way `secretEqual`/`AUTH_TIMEOUT_MS` are already centralized there.

---

**W3. A data-pipe auth/connect failure is indistinguishable from "the line just went quiet"** — `server/board/mcp-server.js:100-136` (`readOutput`/`finish`/`advanceCursor`), `server/board/lib.js:95-118` (`sendSecret`, `connectPipe`) · confidence 55

`connectPipe()` resolves as soon as the pipe connects and `sendSecret()` has fired-and-forgotten the secret line — it never waits for the board to actually accept or reject it. If the board destroys the socket for any reason (a mismatched secret from the C2 race above, a transient `readSecret()` hiccup, a board restart mid-connect), the client sees a `'close'`/`'error'` event; `readOutput`'s `finish()` sets `pipeClosed = true` and resolves with whatever text arrived (empty, since the connection was killed before any data), while `advanceCursor` deletes the cursor cache entry exactly as it would for a genuinely-exited line. The MCP caller gets a **clean, successful empty read** — indistinguishable from "the shell hasn't produced anything new" — with no signal that the read itself silently failed. This directly compounds C2: an operator hitting the secret-desync lockout would see every `switchboard_read_output` call quietly return nothing, not an error pointing at the real cause.

**Fix:** have the board send an explicit auth ack/nak, or at minimum have the client distinguish "closed before any bytes ever arrived" from a genuine post-attach close, so an auth failure surfaces as an error rather than a false-quiet read.

### Notes

**N1. `originAllowed` treats an empty-string `Origin` header identically to an absent one** — `server/src/origin.js:26` · confidence 33

`if (origin === undefined || origin === '') return true;` — deliberate and tested (`server/src/origin.test.js` pins both cases), not an oversight. The `'null'` literal (sandboxed iframe / `file://`) is correctly denied via URL-parse failure. No realistic modern-browser path that emits an empty-but-present `Origin` header on a browser-mediated request was identified, and the practical exposure is narrow: the WS path still requires `checkToken` immediately after (`server/src/ws.js:20`), and REST still requires `authMiddleware` — so this branch alone doesn't grant access except under `AR_NO_AUTH=1`, where the origin gate becomes the sole gate and this would matter. Kept as a NOTE given the low exploitability confidence.

**N2. Per-chunk UTF-8 decoding in the pre-auth handshake can corrupt multi-byte characters split across a chunk boundary** — `server/board/board.js:142-155` · confidence 40 (demoted from WARNING per low-confidence rule)

`authBuf += d.toString('utf8')` decodes each incoming raw chunk independently; a multi-byte UTF-8 sequence split across two `'data'` events gets its truncated half replaced with U+FFFD before concatenation, and the corrupted result is forwarded verbatim to the pty (`p.write(rest)`, line 154) if it lands in the same connection as the secret line. This is most likely to bite the new bracketed-paste feature's larger, non-ASCII payloads, but the exact chunk-boundary timing required is narrow and unconfirmed on this transport. No test sends non-ASCII text through the combined secret+payload path.

**N3. `makeRunFeeder`'s documented silent-shell double-run risk has no regression test** — `server/board/board.js:57-100`, `server/board/board.test.js:93-149` · confidence 40 (demoted from WARNING)

The design comment (board.js:52-56) already acknowledges that a shell with echo off and a genuinely-silent-but-successful command can be double-run — an accepted, documented trade-off, not a hidden defect. But no test pins that accepted behavior (every existing test covers either "total silence → retry" or "any output → settle, no retry"; none covers "delivered, executed, silent"), so a future change to `confirmMs`/`maxSends` could make the trade-off worse with nothing to catch it.

**N4. `sendInput`'s options-object parameter is undocumented at its own call site** — `server/board/mcp-server.js:185-186` · confidence 45

`function sendInput(id, text, opts)` passes `opts` straight through to `framePayload` with no destructuring of its own, while its sibling `readOutput` in the same file self-documents its accepted options inline (`{ waitMs = 400, maxWaitMs = 3000, ... } = {}`, line 100). Minor inconsistency in an otherwise-consistent file.

**N5. `server/board/autostart.ps1`'s relative path to the shared script is an unverified, unenforced coupling** — `server/board/autostart.ps1:19` · confidence 25

`Join-Path $PSScriptRoot '..\..\autostart-task.ps1'` hard-codes the directory depth with nothing but a comment enforcing it. Low priority: PowerShell throws loudly on a bad path (no silent failure), just not until someone actually runs `install`/`uninstall`/`status` after a future move.

**N6. `makeRunFeeder`'s "did the shell react" check is a tautology, not a time comparison** — `server/board/board.js:88` · confidence 55

`else if (now() >= lastSendAt)` reads as if it's filtering on *when* output arrived relative to the send, but `now()` is `Date.now()` — monotonic non-decreasing — so this condition is true for essentially any `onData()` call after the first `send()`, regardless of actual timing. The real semantics ("any output after a send counts as delivered") match the design comment, so this isn't a bug, but the conditional implies a temporal check it isn't actually performing — worth a comment or simplifying to `sends > 0` so a future reader doesn't spend time looking for the timing logic that isn't there.

### Summary

Two CRITICAL findings, both grounded in code the orchestrator read in full and cross-validated against three independent review lenses: **C1** (all three personas independently converged on the same control-plane buffer-cap gap — the strongest signal in this review) can crash the entire board daemon from an unauthenticated local connection, and **C2** (found only by the Saboteur, but independently confirmed) can permanently brick the tool's auth for every client via ordinary concurrent use, with no automatic recovery. Both should be patched immediately given this range is already on `main`. The warnings (W1-W3) point at the same underlying pattern — security-critical logic was hardened in one place and not its twin, and none of it was verified with the rigor the pipe-DACL fix itself demonstrated is achievable in this codebase.

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| C1 | CRITICAL | 85 | Control-plane pipe has no buffer cap — DoS + full daemon crash (no uncaughtException handler) | (open) |
| C2 | CRITICAL | 68 | Concurrent cold-start races can desync the secret file, permanently locking out every client | (open) |
| W2 | WARNING | 70 | Duplicated auth-handshake/compare logic is the root cause behind C1 | (open) |
| W1 | WARNING | 58 | Windows secret-file mode bits are inert; inherited ACL never verified | (open) |
| W3 | WARNING | 55 | Auth/connect failures on a data pipe masquerade as a clean empty read | (open) |
| N6 | NOTE | 55 | `makeRunFeeder`'s reaction check is a tautology given monotonic time | (open) |
| N4 | NOTE | 45 | `sendInput`'s options object is undocumented at its own call site | (open) |
| N2 | NOTE | 40 | Per-chunk UTF-8 decode in the pre-auth path can corrupt split multi-byte chars | (open) |
| N3 | NOTE | 40 | `makeRunFeeder`'s accepted double-run risk has no regression test | (open) |
| N1 | NOTE | 33 | Empty-string `Origin` treated as trusted non-browser client | (open) |
| N5 | NOTE | 25 | `server/board/autostart.ps1`'s relative path to the shared script is unenforced | (open) |
