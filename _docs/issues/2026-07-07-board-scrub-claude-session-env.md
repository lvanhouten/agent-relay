# The board leaks its launcher's Claude-session identity into every Line

**Source:** conduct-feature FIRST-USE run, 2026-07-07 — a `claude` spawned in a relay Line wrote no conversation transcript JSONL, silently breaking conduct-feature's transcript-tailing wait/detection loop. Root-caused to inherited Claude-session env markers.
**Status:** ✅ Fixed — 2026-07-07 (this change). Boot-time env scrub in `server/board/board.js`.
**Kind:** Bug (environment leak)
**Modules:** server/board (`board.js` daemon startup — the process that spawns every Line)
**Severity:** Medium-high — invisible: the affected session looks completely healthy (MCP logs still write, the terminal behaves normally), yet every transcript-tailing consumer is broken with no error to catch. Cost real debugging time before the env was inspected.

## Symptom

A `claude` launched inside a relay Line does not write its conversation transcript to `~/.claude/projects/<cwd-slug>/<uuid>.jsonl`. Nothing errors. The session runs, responds, and its MCP-side logs write normally, so it looks healthy — but any consumer that reads the conversation transcript (conduct-feature's entire wait/detection loop; the transcript-tailing bet in `2026-07-02-claude-native-lines.md`; the resume launcher in `2026-07-07-transcript-resume-launcher.md`) gets nothing.

## Root cause

The relay daemon is typically started **from inside a Claude Code session** (e.g. `npm start`/`npm run server` run in a session, or autostart from a session-hosted web tier). Claude Code injects a set of "you are running inside a session" identity markers into the env of every process it spawns; the daemon inherits them into `process.env` at boot. `board.js`'s `createLine` then spawns each Line's PTY with `env: { ...process.env, AGENT_RELAY_SESSION: id }` — so those markers flow straight down into every Line, and from the Line into any `claude` launched there.

A `claude` that sees `CLAUDE_CODE_CHILD_SESSION` in its env treats itself as a **nested child session** and deliberately suppresses transcript writing. The marker propagation chain:

```
Claude Code session
  └─ npm start (inherits CLAUDE_CODE_CHILD_SESSION, CLAUDECODE, …)
      └─ web tier → lib.js startBoard() → detached board.js (inherits, no env override)
          └─ createLine → PTY Line  { ...process.env }   (inherits)
              └─ claude               (sees CLAUDE_CODE_CHILD_SESSION → writes no transcript)
```

Consumers had been working around it by prefixing every Line's `run` command with `Remove-Item Env:\CLAUDE_CODE_CHILD_SESSION` — per-consumer, easy to forget, and blind to the other markers.

## Fix (chosen design: code-level boot scrub)

Delete the Claude-session identity markers from `process.env` at daemon startup in `board.js`, before any Line is created. Because `createLine` reads `process.env` at spawn time, scrubbing it once at boot cleans the env for **every child the daemon ever spawns** — Lines and panes alike.

**Why the daemon startup code and not the launcher scripts:** there are several launch paths (autostart PowerShell, the scheduled task, and someone running `npm start` **from inside a Claude session** — the exact path that caused the incident). A scrub in any one launcher misses the others, and none cover ad-hoc starts. The daemon is the single chokepoint every Line inherits from, so a scrub there holds for all launch paths at once. The web tier (`index.js`) is deliberately **not** touched — it spawns no `claude`; only the board spawns Lines, so the board is the one correct place.

**Why an explicit allowlist, never a `CLAUDE_*` glob:** a user may deliberately export machine-wide config in their shell profile (`CLAUDE_EFFORT`, `CLAUDE_AFK_TIMEOUT_MS`, `ANTHROPIC_API_KEY`, …). The daemon cannot distinguish inherited-from-session from set-on-purpose, so it removes only the runtime-injected **session-identity** markers — the ones no one exports by hand. Inspected from a live session's env; the scrubbed set:

| Marker | What it is |
|---|---|
| `CLAUDECODE` | `1` — the nested-session flag Claude Code checks |
| `CLAUDE_CODE_CHILD_SESSION` | the marker that suppresses transcript writes (the incident) |
| `CLAUDE_CODE_SESSION_ID` | the parent session's id |
| `CLAUDE_CODE_ENTRYPOINT` | how the parent session was entered (`cli`/…) |
| `CLAUDE_CODE_EXECPATH` | the parent session's `claude` binary path |

Explicitly **preserved** (config/preferences, not identity): `CLAUDE_EFFORT`, `CLAUDE_AFK_TIMEOUT_MS`, and anything `ANTHROPIC_*`.

## Verification (2026-07-07)

- **(a)** Restarted the daemon deliberately from inside a Claude Code session (the incident's reproduction), spawned a Line, printed its env — all five markers absent.
- **(b)** Launched `claude` in a Line; a conversation transcript JSONL materialized under `~/.claude/projects/<slug>/` after one turn.
- **(c)** A plain-shell Line's env is otherwise unchanged — only the allowlisted markers are gone (`CLAUDE_EFFORT` and the rest survive).

## Cross-references

- `2026-07-07-rendered-screen-read-output.md` — **related but separate.** Both surfaced in the same 2026-07-07 conduct-feature FIRST-USE run, and both matter to transcript-first detection. That issue makes the **PTY** read of a Claude Line trustworthy (rendered screen vs. raw ANSI); this one makes the **transcript** of a Claude Line exist at all. They're complementary halves — screen state vs. transcript history — not the same fix, and were kept as distinct docs.
- `2026-07-02-claude-native-lines.md` / `2026-07-07-transcript-resume-launcher.md` — both depend on Lines actually writing transcripts; this fix is a silent prerequisite for either.
