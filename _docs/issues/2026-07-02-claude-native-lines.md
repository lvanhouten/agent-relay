# Lines are opaque PTYs even when they're Claude Code sessions with structured state sitting on disk

**Source:** Feature-gap brainstorm, 2026-07-02 — the radical bet: most lines on this board *are* Claude Code sessions, and Claude Code already writes structured JSONL transcripts; the relay ignores all of it and scrapes ANSI.
**Status:** 💡 Proposed — 2026-07-02. **Narrowed 2026-07-07:** the "hooks-only alternative" split out to `2026-07-07-hook-beaconed-session-state.md` (different risks, standalone value, ready now). This doc is now only the transcript-tailing bet — the JSONL tailer and the chat view — and depends on that issue's SessionStart binding.
**Kind:** Enhancement (architectural)
**Modules:** server/sessions (or new `src/claude-state.js`), client (new view)
**Severity:** High value / high effort — the big design bet; needs a grilling session before any code.

## Motivation

The board treats every line as bytes-in/bytes-out. But a Claude Code session has real, machine-readable content: the JSONL transcript under `~/.claude/projects/<cwd-slug>/<session-uuid>.jsonl` records every message, tool call, and token count as it happens (format verified on disk 2026-07-07: newline-delimited JSON, one entry per event, each carrying `type`, `sessionId`, `cwd`, `gitBranch`, `timestamp`, `version`, and full message content including `tool_use` blocks and usage). A line that *knows* it's a Claude session could expose message-level state. That unlocks:

- A chat-style mobile view — rendered messages instead of ANSI soup reflowed to a phone width, with the raw terminal one tap away.
- Notification bodies with content ("blocked on: `rm -r build/`") instead of a bare needs-input flag.
- The multi-session audit workflow (blind sessions spawned via switchboard) as a first-class pattern with readable per-session summaries.

Coarse status ("running / turn done / needs input") does **not** need this — that's the split-out hooks issue, which is cheaper and standalone. This doc earns its keep only if the *content* views above are wanted.

## Proposal outline

- Binding line id → transcript file is solved upstream: the SessionStart beacon (`2026-07-07-hook-beaconed-session-state.md`) stores `transcriptPath` per line. No cwd/newest-file guessing anywhere. (prerequisite, not work here)
- A transcript tailer per Claude line — a web-tier concern, not a board concern: the board stays a dumb PTY kernel; `BoardSessions` (or a new `src/claude-state.js`) tails the JSONL and merges structured state into the DTO. Incremental reads from a stored byte offset (files run 200KB–3MB per session); filter thinking-signature blobs (large base64); subagent transcripts live in per-session subdirectories — decide whether they surface at all. (large)
- Client: terminal screen gains a "conversation" tab rendering transcript messages; session card may show last-message snippets. (large)

## Risks / open questions

- **Privacy weight is the headline risk:** transcripts contain everything the agent saw — reading them into the relay and rendering them into a browser raises the stakes of every existing auth/origin decision. The scoped-tokens doc (`2026-07-02-scoped-tokens.md`) becomes much less optional in this world; possibly a hard prerequisite.
- Coupling to an undocumented on-disk format that Claude Code can change under us (entries carry a `version` field — e.g. `2.1.200` — but no compatibility promise). The tailer must degrade gracefully to opaque-PTY behavior on any parse failure.
- Tail cost at fleet scale: N lines × MB-scale append-only files; needs fs-watch or lazy read-on-request, not polling reads of whole files.
- Chat view vs. terminal truth: the transcript lags the PTY (and omits raw TUI state like permission prompts mid-render); the view must not pretend to be live when it's behind. That gap is exactly what `2026-07-07-rendered-screen-read-output.md` fills from the PTY side (rendered grid = current UI state; transcript = history + verbatim content) — complements, not rivals.

## Trigger signals to prioritize

- `2026-07-07-hook-beaconed-session-state.md` has landed **and** its coarse states prove insufficient — someone keeps opening the raw terminal just to read what the agent said.
- A concrete consumer for message content: the mobile chat view being actively missed, or notification bodies needing the blocked command. Caveat (2026-07-07): if `2026-07-07-rendered-screen-read-output.md` lands first, its rendered grid can feed notification bodies with the on-screen dialog text (wrapped/truncated, vs. verbatim here) — likely covering that unlock and leaving the chat view as this doc's sole real driver.
- Run this through a grill/PRD pass before committing — the tailing architecture and the privacy/scoped-tokens sequencing are exactly ADR-shaped.
