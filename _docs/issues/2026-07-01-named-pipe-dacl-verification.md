# Board named pipes are created with no explicit access-control restriction

**Source:** Came up auditing the board daemon's IPC surface. The board creates its control pipe and one data pipe per line with a bare listen on the pipe path, relying on the OS default DACL. Whether that default is actually scoped to the creating user was never verified, and if it's broader it would upgrade the "trust the local user" design from accepted-by-design to a real local-escalation gap.
**Status:** ✅ Resolved — 2026-07-02 (verified real, then fixed via a per-boot access secret).
**Kind:** Tech-debt
**Modules:** board
**Severity:** Medium

## Verification (2026-07-02)

Performed by connecting a read-only `NamedPipeClientStream` to a live board pipe and calling `.GetAccessControl()` (`READ_CONTROL` rides along with a read handle — no AccessChk or native P/Invoke needed). Both the control pipe and a per-line data pipe carry the same default DACL:

| Principal | Rights | Write (inject)? | Read (output)? |
|---|---|---|---|
| `Everyone` | `0x120089` (read-only) | No | **Yes** |
| `NT AUTHORITY\ANONYMOUS LOGON` | `0x120089` (read-only) | No | **Yes** |
| creating user / SYSTEM / Administrators | full | Yes | Yes |

So the finding is **confirmed and broader than the creating user** — but narrower than a full escalation: `Everyone` lacks `FILE_WRITE_DATA`, so command injection / keystroke injection is default-denied. The live gap is **PTY-output disclosure** to any local user (and `ANONYMOUS LOGON`) on a multi-user machine, since the data plane pushes scrollback + live output to any connected socket. Probe scripts + evidence: recorded in the remediation session.

## Resolution — per-boot access secret

A pipe security descriptor can't be set through Node's `net.Server.listen`, so the board now gates **both** planes at the application layer (chosen over a native `CreateNamedPipe` rewrite of the vendored kernel, which was disproportionate for a portable kernel):

- At startup the board generates a random secret and writes it to an owner-only file (`%LOCALAPPDATA%\agent-relay\board.<pipe-base>.secret`; `0700`/`0600` on POSIX). The file lives inside the user profile, which other non-admin users can't traverse — an admin can read it, but an admin already has full pipe access, so no boundary is lost.
- Every client connection must send `<secret>\n` as its first line before the board dispatches a command or streams any output; a wrong/absent secret is dropped (control) or receives nothing (data), with a 5s auth timeout for a connection that stalls pre-auth.
- The handshake is centralized in `lib.js` (`connectPipe`/`connectControl` send it; `board.js` verifies with a constant-time compare), so all clients — web tier, `sb`, `patch`, `mcp-server` — are covered without per-caller code. Secret is read fresh per connect, so a client reconnecting after a board restart picks up the new secret.

Verified end-to-end on an isolated board: a legit client reads output; a foreign reader with a wrong secret gets 0 bytes; a silent reader is dropped at the auth timeout; a rejected control client doesn't disturb the legit control path. Unit tests: `server/board/lib.test.js` (generate/persist/read round-trip + constant-time compare).

## Original finding (retained)

Nothing had been closed at deferral time — this was a verify-then-maybe-fix item. The verification step could not be performed in the original remediation environment: no AccessChk/`accesschk64` was available, and Windows named-pipe DACLs are not inspectable via `icacls` (filesystem only) or `Get-Acl` without native P/Invoke. (The `.GetAccessControl()` approach above sidesteps that.)

## What remains

In `server/board/board.js`, the control pipe (`board.listen(CTRL)`, ~line 196 after recent edits) and every per-line data pipe (`server.listen(dataPipe(id))`, in `createLine`) are created with a bare `net.Server.listen(pipePath)` — no explicit Windows security descriptor. Node/libuv applies a default named-pipe DACL that is not guaranteed to be scoped to the creating user/session. If the effective DACL grants access beyond the creating user, any other local user (or a lower-integrity process) could open the control pipe and issue `new`/`end`/`resize`/`shutdown` commands, or attach to a line's raw byte stream — spawning or driving PTYs and reading their output. Under the app's stated single-local-user trust model this is accepted; a broader-than-same-user DACL breaks that assumption.

## Fix outline

- First: verify the effective DACL on a live board pipe (AccessChk `accesschk64 -p \pipe\agent-relay`, or a small native/P-Invoke probe of `GetSecurityInfo` on the pipe handle). This determines whether any fix is needed at all.
- If broader than the creating user: apply an explicit restrictive security descriptor. Node's `net.Server.listen` does not expose a pipe security-descriptor option across all versions, so this likely means either creating the pipe via a native addon / `CreateNamedPipe` with an explicit `SECURITY_ATTRIBUTES`, or gating access another way. (medium–large; the interop is the cost)
- Cross-cutting risk: the board is intentionally reachable by multiple *same-user* local consumers (the web tier, the `sb` CLI, `mcp-server`, WezTerm panes). Any DACL must keep same-user, cross-process access working — over-tightening to a single process would break the design.
- Keep it Windows-scoped: the pipe path is Windows-only (`\\.\pipe\...`); a POSIX build would use a different transport and its own permissioning.

## Trigger signals to reopen

- The DACL verification is performed and shows access broader than the creating user.
- The board is ever run on a shared / multi-user machine (terminal server, shared build box).
- Any move toward exposing the board beyond a single interactive desktop session.

## Repro

Verification, not a demonstrated exploit: start the board, then inspect the pipe's DACL (e.g. `accesschk64 -nobanner \pipe\agent-relay`). If the ACE list grants more than the creating user, the escalation path is real; if it's already same-user-scoped, this can be closed as won't-fix with the evidence recorded.
