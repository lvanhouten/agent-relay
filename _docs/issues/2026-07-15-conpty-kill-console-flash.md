# Killing a line flashes a console window on Windows

**Source:** User observation, 2026-07-15 — "when I kill a switchboard line, I get a quick commandline popup window that appears and disappears ~0.1s later."
**Status:** 💡 Proposed — 2026-07-15. Root-caused; the fix has a fork to settle (naive vs. robust) before code.
**Kind:** Bug (cosmetic) with a non-cosmetic fix trap. Windows-only.
**Modules:** `server/board/board.js` (`pty.spawn` at ~L245; the `end` handler `s.pty.kill()` at ~L521, and the shutdown-all loop at ~L572). No web-tier change.
**Severity:** Low — purely visual; nothing leaks, nothing is left running. But the *obvious* fix (`useConptyDll`) silently regresses process reaping, so this is worth doing deliberately rather than reaching for the one-liner.

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

node-pty's DLL-based ConPTY kill path (`windowsPtyAgent.js:153-159`) skips the fork entirely — just `inSocket.destroy()` + native kill. No `AttachConsole`, no flash. One-line opt-in in the `pty.spawn` options.

**But** it also drops the process-list reaper. A detached/backgrounded grandchild (dev server, double-forked process) can survive as an orphan — no console, no parent, still holding its ports. This *reintroduces* the exact problem the default path was built to prevent, and this repo hits that problem in practice. Do not ship A alone.

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

Net: no flash **and** no orphans — but more moving parts than the one-liner, so it needs real verification (below) before trusting.

## Risks / open questions

- **Must verify against a real Claude-line-with-a-dev-server**, not a bare shell. Spawn a line, run `npm run server` in it (or a `run_in_background` job), kill the line, then confirm the child `node`/`vite` is gone (`Get-CimInstance Win32_Process` / kill-by-port shows nothing on :3017/:5173). This is the whole point of Option B; prove it reaps.
- **`taskkill` timing vs. `pty.kill()`.** `taskkill` is async (a spawned process); `s.pty.kill()` fires right after. Killing the tree first then closing the pty is the intended order, but confirm there's no race where the pty handle close races the taskkill and one path wins messily. If ordering is fiddly, await the taskkill exit before `pty.kill()`.
- **`taskkill` availability / exit noise.** It's present on all supported Windows; `stdio: 'ignore'` swallows its output. A PID that's already gone returns non-zero — harmless, but don't let it throw into the `end` handler.
- **Board restart required to test.** The `pty.spawn` option change only affects **newly** spawned lines, and the board is a long-lived daemon — restarting it ends every live line (see CLAUDE.md). Test on an isolated board via `AGENT_RELAY_PIPE` (template: `server/board/tombstone.e2e.test.js`), not the production board.
- **Windows-only guard.** Both the `useConptyDll` option and the `taskkill` branch are Windows-specific; the option is ignored elsewhere and the `spawn` must stay behind the `process.platform === 'win32'` check.
- **Cosmetic-only today.** If the flash ever proves genuinely harmless-and-tolerable, "won't fix" is defensible — the reaper regression risk is the reason this isn't a trivial one-liner, not the flash itself.

## Trigger signals to prioritize

- The flash becoming an actual annoyance during heavy fleet use (lots of kills in a session).
- Any move to auto-kill lines programmatically (e.g. a "kill all exited" sweep) — many kills in quick succession would strobe.
- Touching the board's kill/shutdown path for another reason — fold this in while it's already open.

## Relationship to other issues

- Independent of the desktop-shell and notification work; this is pure board/kernel behavior. No dependency either direction.
