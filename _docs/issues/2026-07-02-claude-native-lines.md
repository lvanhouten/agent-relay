# Lines are opaque PTYs even when they're Claude Code sessions with structured state sitting on disk

**Source:** Feature-gap brainstorm, 2026-07-02 — the radical bet: most lines on this board *are* Claude Code sessions, and Claude Code already writes structured JSONL transcripts; the relay ignores all of it and scrapes ANSI.
**Status:** 💡 Proposed — 2026-07-02.
**Kind:** Enhancement (architectural)
**Modules:** board, server/sessions, client (new view)
**Severity:** High value / high effort — the big design bet; needs a grilling session before any code.

## Motivation

The board treats every line as bytes-in/bytes-out. But a Claude Code session has real, machine-readable state: the JSONL transcript under `~/.claude/projects/<project-slug>/` records every message, tool call, and token count as it happens. A line that *knows* it's a Claude session could expose: current tool call, last assistant message, waiting-on-permission, tokens burned. That unlocks:

- A chat-style mobile view — rendered messages instead of ANSI soup reflowed to a phone width, with the raw terminal one tap away.
- Honest fleet status: "3 running, 1 blocked on permission, 1 done" — superseding the heuristic half of `2026-07-02-session-attention-states.md`.
- The multi-session audit workflow (three blind sessions spawned via switchboard) as a first-class pattern instead of a hand-rolled one.

## Proposal outline

- `new` accepts `type: 'claude'` (or the relay infers it from the `run` command); the line record carries it; `toDto()` exposes it. (small)
- A transcript tailer per Claude line — plausibly a web-tier concern, not a board concern: the board stays a dumb PTY kernel, and `BoardSessions` (or a new `src/claude-state.js`) tails the JSONL and merges structured state into the DTO. Keeping the kernel dumb preserves the "board = vendored PTY kernel" boundary. (large)
- Client: session card shows structured status; terminal screen gains a "conversation" tab rendering the transcript messages. (large)

## Risks / open questions

- **The binding problem is the crux:** mapping line id → transcript file. Heuristics (cwd + newest-file) are racy with concurrent sessions in one repo. Honest options: inject an env marker when spawning (`AGENT_RELAY_SESSION=<id>` visible in the hook environment), and/or a `SessionStart` hook that POSTs `{ lineId, transcriptPath }` to the relay. The hook route needs no transcript-path guessing at all.
- **Hooks-only alternative:** if hooks can beacon every state transition (`Notification`, `Stop`, `PreToolUse`), the relay gets state without ever parsing transcripts — massively cheaper, no file-format coupling, but no message content for the chat view. Possibly the right phase 1, with transcript tailing as phase 2 only if the chat view earns its keep.
- **Privacy weight:** transcripts contain everything the agent saw — reading them into the relay and rendering them into a browser raises the stakes of every existing auth/origin decision. The scoped-tokens doc (`2026-07-02-scoped-tokens.md`) becomes less optional in this world.
- Coupling to an undocumented-ish on-disk format that Claude Code can change under us; the tailer must degrade gracefully to "opaque PTY" behavior.

## Trigger signals to prioritize

- Attention-state heuristics (`quiet` vs. genuinely blocked) proving too coarse in practice.
- A second product surface wanting structured session data (fleet dashboard, templates with status, notification bodies that name the blocked tool).
- Run this through a grill/PRD pass before committing — the binding-problem and hooks-vs-tailing decisions are exactly ADR-shaped.
