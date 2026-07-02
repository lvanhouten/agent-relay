# The board access-secret file's real confidentiality boundary on Windows is unverified and rests on inherited ACLs, not the (inert) mode bits

**Source:** Came up while hardening the board's per-boot access secret — the plaintext secret that now stands in for a pipe security descriptor Node can't set. The file is written with POSIX-style `mode` bits that do nothing on Windows NTFS, so the actual "only the creating user can read it" guarantee was never proven the way the pipe DACL was.
**Status:** ⏸ Deferred — 2026-07-01.

<!-- Status lifecycle — update the icon + label (and date) as the issue moves. New docs start ⏸ Deferred:
     ⏸ Deferred  — parked; waiting on a trigger signal below to fire.
     🔴 Reopened  — a trigger signal fired; back in the active queue (note what fired it + the date).
     ✅ Resolved  — fixed; record the commit/PR and the date.
     ✋ Won't fix  — decided not to address; record the reason and the date. -->
**Kind:** Tech-debt (security-hardening verification)
**Modules:** board kernel (server/board/lib.js — the access-secret file)
**Severity:** Medium — if the assumption is false, the confidentiality boundary the whole named-pipe hardening now rests on is silently open; if it holds (the expected case on a standard single-user profile), there is no live exposure.

## What's already been closed

Nothing narrows this — it is the standing residual of the access-secret work. The pipe-connection side of the boundary (the per-boot secret gate on both the control and data planes) is now solid: the shared handshake with its buffer cap is centralized and both planes reject a wrong or absent secret. What remains untested is the *other* way to obtain the secret — reading the file straight off disk.

## What remains

`server/board/lib.js` writes the secret with `fs.mkdirSync(dir, { mode: 0o700 })` and `fs.writeFileSync(file, secret, { mode: 0o600 })`. On Windows those `mode` bits are a documented no-op — Node does not translate them into an NTFS ACL. So the entire real protection for the plaintext secret is whatever ACL `%LOCALAPPDATA%\agent-relay\` *inherits* from the user-profile directory. The lib.js comment asserts "NTFS already denies other non-admin users traversal into another profile," but that assumption was never live-tested — in contrast to the pipe DACL, which a prior change verified with an actual `.GetAccessControl()` probe before shipping.

If the inherited directory ACL is ever broader than the creating user — roaming or redirected profiles, a loosened AppData ACL, a sync/backup agent that widens permissions — a foreign local user reads the secret directly from the file and fully reopens the exact vulnerability the secret was introduced to close (PTY-output disclosure via any data pipe, and command dispatch via the control pipe), just via file read instead of pipe read.

POSIX has a lesser version of the same gap: `mode` only applies at file/dir *creation* time, so a pre-existing `~/.agent-relay` directory created earlier with wider permissions is never retroactively tightened.

## Fix outline

- **Decide the policy first (this is the product/ops call that makes it a deferral, not a drop-in patch):** when the effective ACL on the secret file is broader than "creating user (+ SYSTEM/Administrators, who already own the pipe anyway)," should the board (a) refuse to start, (b) start but log a loud warning, or (c) auto-tighten and continue? Fail-closed is safest but can brick startup on legitimate roaming/redirected-profile setups; that trade needs a human decision. (small decision, large blast radius)
- **Windows: reset the ACL explicitly after creating the dir/file** rather than relying on inheritance — e.g. `icacls <dir> /inheritance:r` then grant only the current user + SYSTEM + Administrators. Must be best-effort and non-fatal by default, with correct SID handling, and must not throw at startup on odd profiles. (medium)
- **Windows: live-verify the effective ACL** with a real probe the way the pipe DACL was verified (PowerShell `Get-Acl` / `.GetAccessControl()`), asserting no other-user read ACE, and wire that verification into a test that runs in a representative environment. (medium — needs a multi-user Windows test rig this worktree does not have)
- **POSIX: retroactively tighten** an already-existing dir/file with `fs.chmodSync(dir, 0o700)` / `chmodSync(file, 0o600)` on startup, so a pre-existing wide directory is narrowed rather than trusted. (small — the one piece that is safely scoped and testable in isolation)
- Cross-cutting risk: ACL manipulation and fail-closed startup can lock a legitimate user out of their own board; every arm must be validated against roaming/redirected-profile scenarios before shipping.

## Trigger signals to reopen

- Any report of a foreign local user reading `%LOCALAPPDATA%\agent-relay\board.*.secret` (or an audit finding the ACL is broader than the creating user).
- The tool is deployed onto roaming, redirected, or network-home-directory profiles, or into a shared/multi-user Windows host where the single-user-profile assumption no longer holds.
- A security review or SOC 2 control requires the on-disk secret's confidentiality boundary to be verified with the same live-probe rigor already applied to the pipe DACL.
- The secret file's location moves out of the per-user profile directory for any reason.

## Repro

Not reproducible in a standard single-user profile (the assumption holds there). To demonstrate the gap: on a Windows host, broaden the ACL on `%LOCALAPPDATA%\agent-relay\` (or place the profile on a share whose ACL grants other local users read), start the board as user A, then as user B read `board.agent-relay.secret` directly and use it to connect a data pipe and stream a line's PTY output — the pipe gate accepts it because the secret is correct; only the file's ACL was ever supposed to stop B from learning it.
