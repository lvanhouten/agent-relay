# Board named pipes are created with no explicit access-control restriction

**Source:** Came up auditing the board daemon's IPC surface. The board creates its control pipe and one data pipe per line with a bare listen on the pipe path, relying on the OS default DACL. Whether that default is actually scoped to the creating user was never verified, and if it's broader it would upgrade the "trust the local user" design from accepted-by-design to a real local-escalation gap.
**Status:** ⏸ Deferred — 2026-07-01.
**Kind:** Tech-debt
**Modules:** board
**Severity:** Medium

## What's already been closed

Nothing yet — this is a verify-then-maybe-fix item. The verification step (inspecting the effective DACL on a live pipe) could not be performed in the remediation environment: no AccessChk/`accesschk64` was available, and Windows named-pipe DACLs are not inspectable via `icacls` (filesystem only) or `Get-Acl` without native P/Invoke.

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
