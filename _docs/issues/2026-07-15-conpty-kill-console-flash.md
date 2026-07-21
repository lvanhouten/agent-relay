# Killing a line runs a console-wide process reaper (flashes conhost; can kill the whole board)

**Source:** User observation, 2026-07-15 - "when I kill a switchboard line, I get a quick commandline popup window that appears and disappears ~0.1s later." Escalated 2026-07-21 after the same reaper was found killing the entire board daemon (see the update below).
**Status:** 🟡 Fixed (Option B) 2026-07-21, pending the live production re-run - see Resolution below.
**Kind:** Bug. Windows-only. Two manifestations of ONE reaper: a cosmetic conhost flash (always) and a data-loss daemon-suicide (environment-specific) - see the update.
**Modules:** `server/board/board.js` (`pty.spawn` at ~L241; the `end` handler `s.pty.kill()` at ~L577, and the shutdown-all loop at ~L628). No web-tier change.
**Severity:** High (was mis-scoped Low). The flash is cosmetic, but the underlying reaper force-kills every PID on the killed line's console - and in the production console topology that list includes the board process and every sibling line, so ending ONE line takes down the whole daemon and every live session on it (confirmed - see update).

## UPDATE 2026-07-21 - this is P1: ending one line kills the whole board

The reaper this doc already root-caused (the `consoleProcessList.forEach(pid => process.kill(pid))` at `windowsPtyAgent.js:141-148`) does far more than flash a window. It force-kills **every process on the killed line's console**. This doc assumed that list was just the killed line's own tree. Against the **production** board it is not - it includes the board daemon itself and every sibling line.

**Confirmed reproduction (production board, via the switchboard MCP):** three lines live (id 1 = a real conduct-feature `contract-check` session with a client attached; ids 2, 3 = fresh throwaways). Ended **only** id 3. Result: `list` went empty, the board process pid changed (old daemon `50924` gone, a fresh `39368` autostarted 3s later), and **all four processes - the old board plus all three line shells (pids 51180, 35544, 1432) - were gone.** The board log shows `line 3 closed` immediately followed by a new `switchboard online` with no `shutting down` in between: the daemon didn't exit gracefully, it was killed. Every line dies with exit `-1073741510` (`0xC000013A` = `STATUS_CONTROL_C_EXIT`), the tell that a console-wide kill fired.

This is exactly the operator symptom: "closed the second session and it killed the first one too." It also silently kills unrelated live work - the repro above destroyed a real conductor line.

**Why the isolation repros stay green (important for verification):** four isolated boards on `AGENT_RELAY_PIPE` - including one detached exactly like autostart, one with per-line child trees, and one with 3 lines + an attached client + preview polling - all correctly isolated the kill (sibling and board survived). The suicide only reproduces against the real daemon. The console-sharing that makes the reaper's `AttachConsole` + `GetConsoleProcessList` return the board + siblings is specific to how the production board is consoled (autostarted from a console-attached parent - `npm run server` in a real terminal - vs a `node --test`-parented board that has no such console). **Consequence: there is no clean red→green isolation test for the suicide itself.** Verify the fix by (a) the mechanism - the reaper is removed from the kill path outright - and (b) a live re-run of the production repro after a board restart.

**Why Option B still fixes it without pinning the console cause:** the suicide has exactly one source - that `forEach(process.kill)`. `useConptyDll: true` routes kill through the DLL branch (`windowsPtyAgent.js:153-159`), which never calls `_getConsoleProcessList` and never runs that loop, so the over-broad kill is deleted regardless of the console topology. `taskkill /pid <line-pid> /T` reaps only the line's **descendants**, never ancestors, so it structurally cannot reach the board or a sibling. The fix is correct without understanding *why* the console is shared.

## Symptom

Every time a line is killed (the `end` control command → `s.pty.kill()`), a console window (`conhost.exe`) flashes on screen for ~0.1s and vanishes. One flash per kill. No functional impact observed.

## Root cause (confirmed by reading the installed node-pty)

`node-pty@1.1.0`, Windows 10+, ConPTY backend (fork-based — the default, `useConptyDll: false`).

`s.pty.kill()` → `WindowsPtyAgent.kill()` (`node_modules/node-pty/lib/windowsPtyAgent.js:133`). On the fork-based ConPTY path it calls `_getConsoleProcessList()` (L140), which at L184 does:

```js
child_process_1.fork(path.join(__dirname, 'conpty_console_list_agent'), [innerPid])
```

That forked helper (`conpty_console_list_agent.js`) exists solely to call the native `getConsoleProcessList(shellPid)` — and its own header explains why it must be a separate process: *"there can only be a single console attached to a process."* The native call `AttachConsole`s to the line's shell to enumerate the console's PIDs, and **that attach momentarily materializes a `conhost` window** → the flash. The helper then `process.exit(0)`s.

### Why the fork is there (do not just delete it)

The enumeration is a deliberate reaper. `kill()` doesn't only close the pseudo-console handle — it force-kills **every PID attached to the console** (L141-148: `consoleProcessList.forEach(pid => process.kill(pid))`). The winpty branch's comment (L162-168) records the empirical reason: closing the handle alone "will kill most processes by itself," but *"node servers in particular seem to become detached and remain running"* (cites `microsoft/vscode#26807`). So the fork-and-enumerate is what stops backgrounded grandchildren from orphaning.

This matters **specifically for this repo**: a Claude line routinely spawns `npm run server` / `npm run client` and other backgrounded processes, and CLAUDE.md already documents that "stopping an npm run task often leaves the child node/vite holding the port" (:3017/:5173). That is exactly the `vscode#26807` failure mode. Any fix that drops the reaper trades a 0.1s flash for orphaned dev servers squatting on ports.

## Fix options

### Option A — flip `useConptyDll: true` on spawn (rejected as a standalone fix)

node-pty's DLL-based ConPTY kill path (`windowsPtyAgent.js:153-159`) skips the fork entirely - just `inSocket.destroy()` + native kill. No `AttachConsole`, no flash. One-line opt-in in the `pty.spawn` options. It *does* stop the daemon-suicide (the reaper's `forEach(process.kill)` is on the other branch and never runs).

**But** it also drops the process-list reaper. A detached/backgrounded grandchild (dev server, double-forked process) can survive as an orphan - no console, no parent, still holding its ports. This *reintroduces* the exact problem the default path was built to prevent, and this repo hits that problem in practice. Do not ship A alone.

- Foreground, still console-attached grandchildren (Claude's Bash tool mid-`npm test`) die either way — closing the pseudo-console tears down the shared console.
- Backgrounded / detached grandchildren are the divergence, and the dangerous one.

### Option B — reap the tree ourselves, window suppressed (recommended)

Do the tree-kill in `board.js` *before* `s.pty.kill()`, using our own `spawn` with the window-hide flag that node-pty's internal fork never sets — then flip `useConptyDll: true` so node-pty doesn't *also* fork its enumerator:

```js
// in the `end` handler, before s.pty.kill()
if (process.platform === 'win32') {
  spawn('taskkill', ['/pid', String(s.pty.pid), '/T', '/F'], {
    windowsHide: true,   // the flag node-pty's fork omits — no conhost pops
    stdio: 'ignore',
  });
}
```

`/T` reaps the whole tree (orphans included), `/F` forces, `windowsHide: true` kills the flash. With `useConptyDll: true` also set, node-pty's kill takes the no-fork branch, so there's no second flash and no double enumeration.

Net: no daemon-suicide, no flash, **and** no orphans - but more moving parts than the one-liner, so it needs real verification (below) before trusting.

## Risks / open questions

- **Must verify against a real Claude-line-with-a-dev-server**, not a bare shell. Spawn a line, run `npm run server` in it (or a `run_in_background` job), kill the line, then confirm the child `node`/`vite` is gone (`Get-CimInstance Win32_Process` / kill-by-port shows nothing on :3017/:5173). This is the whole point of Option B; prove it reaps.
- **`taskkill` timing vs. `pty.kill()`.** `taskkill` is async (a spawned process); `s.pty.kill()` fires right after. Killing the tree first then closing the pty is the intended order, but confirm there's no race where the pty handle close races the taskkill and one path wins messily. If ordering is fiddly, await the taskkill exit before `pty.kill()`.
- **`taskkill` availability / exit noise.** It's present on all supported Windows; `stdio: 'ignore'` swallows its output. A PID that's already gone returns non-zero — harmless, but don't let it throw into the `end` handler.
- **Board restart required to test.** The `pty.spawn` option change only affects **newly** spawned lines, and the board is a long-lived daemon - restarting it ends every live line (see CLAUDE.md). Test on an isolated board via `AGENT_RELAY_PIPE` (template: `server/board/tombstone.e2e.test.js`), not the production board.
- **The suicide has no isolation repro.** Four faithful isolated boards did not reproduce it (see the update); only the production daemon does. So the orphan-reaping side of Option B is provable in isolation, but the *suicide fix itself* must be verified two ways: (1) by mechanism - confirm the diff removes the `forEach(process.kill)` reaper from the kill path (`useConptyDll:true`) and scopes the kill to the line's descendants (`taskkill /T`); (2) live - after a board restart with the fix, capture the board pid (boot nonce), spawn two lines, kill one, confirm the board pid is unchanged and the other line survives.
- **Windows-only guard.** Both the `useConptyDll` option and the `taskkill` branch are Windows-specific; the option is ignored elsewhere and the `spawn` must stay behind the `process.platform === 'win32'` check.

## Trigger signals to prioritize

- The flash becoming an actual annoyance during heavy fleet use (lots of kills in a session).
- Any move to auto-kill lines programmatically (e.g. a "kill all exited" sweep) — many kills in quick succession would strobe.
- Touching the board's kill/shutdown path for another reason — fold this in while it's already open.

## Resolution 2026-07-21 (Option B)

Implemented in `server/board/board.js`:

- **`pty.spawn` gets `useConptyDll: true`** (`createLine`) - every new line's kill now takes node-pty's no-fork DLL branch (`windowsPtyAgent.js:153-159`), which never calls `_getConsoleProcessList` and never runs the `forEach(process.kill)` console-wide reaper. The suicide's only source is deleted.
- **`killLineTree(s)`** replaces the bare `s.pty.kill()` at both kill sites (the `end` handler and the `shutdown` loop). On Windows it `spawn`s `taskkill /pid <shell-pid> /T /F` with `windowsHide: true` (no conhost flash), **awaits its exit**, then closes the pty. Awaiting matters: `taskkill` snapshots the PID tree from the still-live shell, so a shell killed first would hide its now-orphaned grandchildren from the walk (the risk this doc raised). `/T` scopes the reap to descendants, so it structurally cannot reach the board (an ancestor) or a sibling line. A 4s guard keeps a wedged `taskkill` under the control-plane RPC timeout; a missing/failed `taskkill` (`error` event) still falls through to `pty.kill()`. Off Windows it is just `s.pty.kill()`.

**Verified:**
- **Mechanism (a):** the diff removes the reaper from the kill path (`useConptyDll:true`) and scopes the kill to descendants (`taskkill /T`) - confirmed by reading the installed `node-pty@1.1.0` kill branches.
- **Orphan-reaping, in isolation (b):** `server/board/kill-tree.e2e.test.js` - an isolated board spawns a line whose shell launches a **detached** node grandchild (own process group, survives a console close); after `end`, the guard asserts the grandchild is gone. Mutation-tested: disabling the `taskkill` makes it fail (the detached grandchild orphans), so the guard tracks the reap, not a console-close side effect.

**Still owed - the live production re-run (cannot be automated):** the daemon-suicide only reproduces against the real console topology (see the update above), and a board restart ends every live line, so this must be done by hand when convenient. After a board restart on the fixed code: capture the board pid, spawn two throwaway lines, `end` one, and confirm the board pid is unchanged and the other line survives. Also confirm the conhost flash is gone on a routine kill.

## Relationship to other issues

- Independent of the desktop-shell and notification work; this is pure board/kernel behavior. No dependency either direction.
