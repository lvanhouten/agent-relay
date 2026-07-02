# Root and board autostart PowerShell scripts are near-identical duplicates

**Source:** Came up auditing the repo's Windows autostart scripts. Two `autostart.ps1` files — one at the repo root (agent-relay server) and one under the vendored board kernel (switchboard board) — are structurally near-identical, differing only in the task name and the target launcher script.
**Status:** ✅ Resolved — 2026-07-02 (Option A: keep the vendored copy pristine, cross-reference only).
**Kind:** Tech-debt
**Modules:** scripts, board (vendored)
**Severity:** Low

## Resolution — Option A (keep vendored pristine)

Chose **not** to deduplicate. The board copy is vendored from the switchboard kernel; extracting a shared parameterized script would force an edit to the vendored file and permanently fork it from upstream, turning every future re-vendor into a manual merge — a recurring cost to save ~40 lines of frozen register/unregister-a-task logic. The two scripts also belong to genuinely different products (the agent-relay server vs the switchboard board daemon); they share a shape, not an owner.

Instead: added a maintainer cross-reference note to the **root** `autostart.ps1` (agent-relay's own, non-vendored) pointing at `server/board/autostart.ps1`, explaining they're intentionally separate and that board-side changes go upstream + re-vendor rather than a hand-edit. The note lives only in the non-vendored file **on purpose** — adding a comment to the vendored script would itself diverge it from upstream, defeating the whole rationale. `server/board/autostart.ps1` is left byte-identical to upstream.

This addresses the "maintainer forgets the sibling" trigger (a pointer sits in the file a maintainer would edit) without any vendoring divergence.

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
