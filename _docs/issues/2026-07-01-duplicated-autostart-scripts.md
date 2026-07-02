# Root and board autostart PowerShell scripts are near-identical duplicates

**Source:** Came up auditing the repo's Windows autostart scripts. Two `autostart.ps1` files — one at the repo root (agent-relay server) and one under the board kernel (switchboard board) — are structurally near-identical, differing only in the task name and the target launcher script.
**Status:** ✅ Resolved — 2026-07-02 (deduplicated into a shared script).
**Kind:** Tech-debt
**Modules:** scripts, board
**Severity:** Low

## Resolution — dedup into a shared script

Deduplicated. The original deferral weighed this against "diverging the vendored board copy from upstream," but that concern doesn't apply: switchboard is the user's own code, fully absorbed into this repo — `server/board/` is its only home, there's no separate switchboard repo synced in. So there is no upstream to diverge from, and the duplication is pure maintenance cost with nothing on the other side of the scale.

- New `autostart-task.ps1` (repo root) holds the register/unregister/status logic, parameterized by `-TaskName`, `-Vbs`, `-Description`, and `-RunningNote` (the how-to-stop-a-running-instance hint in the uninstall message).
- `autostart.ps1` (root) and `server/board/autostart.ps1` are now thin wrappers: each keeps its own header/usage and `param($Action)`, resolves its own launcher `.vbs` via `$PSScriptRoot`, and calls the shared script with its product's arguments. The board wrapper reaches the shared script at `..\..\autostart-task.ps1`.
- A fix to the task-registration logic now lives in one place.

Verified: running `status` through both wrappers correctly reports each task (`agent-relay` / `switchboard`) via the shared script — confirming the delegation and the board wrapper's relative-path resolution work. The register/unregister logic is unchanged from the originals, only parameterized.

## Original finding (retained)

The bodies of `autostart.ps1` (repo root) and `server/board/autostart.ps1` shared the same install/uninstall/status structure against a Windows Scheduled Task, differing only by `$TaskName` (`agent-relay` vs `switchboard`) and the launcher `.vbs` (`start-relay.vbs` vs `start-board.vbs`). A fix to one had no reason to remind a maintainer the sibling needed the same edit.
