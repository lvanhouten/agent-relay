# Root and board autostart PowerShell scripts are near-identical duplicates

**Source:** Came up auditing the repo's Windows autostart scripts. Two `autostart.ps1` files — one at the repo root (agent-relay server) and one under the vendored board kernel (switchboard board) — are structurally near-identical, differing only in the task name and the target launcher script.
**Status:** ⏸ Deferred — 2026-07-01.
**Kind:** Tech-debt
**Modules:** scripts, board (vendored)
**Severity:** Low

## What's already been closed

Nothing — this is a maintainability cleanup, not a defect.

## What remains

`autostart.ps1` (repo root) and `server/board/autostart.ps1` share the same install/uninstall/status structure against a Windows Scheduled Task, differing only by `$TaskName` (`agent-relay` vs `switchboard`) and the launcher `.vbs` (`start-relay.vbs` vs `start-board.vbs`). A fix to one (e.g. the `CimException` handling, or a change to the registration principal) has no reason to remind a maintainer the sibling needs the same edit.

## What remains to decide

The board copy is **vendored** — it's part of the switchboard kernel copied into this repo. Deduplicating into a shared parameterized script would diverge the vendored copy from its upstream, complicating future re-vendoring. So the call isn't purely "dedup for cleanliness"; it trades duplication against keeping the vendored tree pristine. That trade-off is the user's to make.

## Fix outline

- Option A (keep vendored copy pristine): leave the board script alone; accept the duplication as the cost of vendoring. Possibly add a one-line comment in each noting the sibling exists.
- Option B (dedup): extract a shared `autostart-task.ps1` taking `-TaskName` and `-Vbs` params, and have both entry points call it — but this modifies the vendored file, diverging from upstream.
- Cost: small either way; the risk is entirely in the vendoring divergence, not the code.

## Trigger signals to reopen

- A bug is fixed in one autostart script and the sibling is found to still have it.
- The board kernel is re-vendored and the divergence causes a merge conflict.
- The two scripts' logic is about to grow materially (more than the current task register/unregister).

## Repro

Diff `autostart.ps1` against `server/board/autostart.ps1`: the bodies are the same modulo `$TaskName` and the `.vbs` filename.
