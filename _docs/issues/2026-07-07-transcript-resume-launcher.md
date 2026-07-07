# Resume a dormant Claude transcript into a live line

**Source:** Feature-gap brainstorm, 2026-07-07 — Claude Code writes a resumable JSONL transcript for every session; the relay could list the *dormant* ones (past conversations not currently running as a line) and, on click, spawn a PTY that `claude --resume`s the conversation back to life.
**Status:** 💡 Proposed — 2026-07-07. Grill the resume model before any code.
**Kind:** Enhancement (feature)
**Modules:** server (new read-only `src/transcripts.js` + `/api/transcripts` route), client (new list/section in `SessionsScreen`)
**Severity:** Medium value / medium effort — most of the mechanism already exists; the design questions are the work.

## Motivation

The board's "active sessions" list is the set of PTYs *currently running*. But every Claude Code session leaves a structured, **resumable** transcript on disk at `~/.claude/projects/<cwd-slug>/<session-uuid>.jsonl` long after the line is gone — ~39 for this project alone, hundreds across all projects. Two facts make these worth surfacing:

1. **They're a distinct population from live lines.** A dormant transcript is a past conversation with no process behind it — exactly the thing the "active sessions" view *can't* show. It wants its own list/look.
2. **They're resumable, not just readable.** The filename is the session UUID, which is the `--resume` target; each entry records its own `cwd` and `gitBranch`. So "reopen this conversation on my phone" becomes a real action, not just a read.

The `--resume` bridge is the point. This is the sibling of `2026-07-02-claude-native-lines.md` (which reads the transcript of a line that's *currently running*, and renders its content) — but aimed at the opposite set and with a different, lighter goal: **relaunch**, not render.

### Why this can ship ahead of claude-native-lines

`claude-native-lines` is gated on privacy / scoped-tokens **because it renders transcript content into the browser**. This feature doesn't have to. The list shows only **metadata** — project, branch, last-activity time, and a title (the first typed user message; verified present as `message.content` on the first `type:"user"` entry). The actual conversation only ever appears **in the PTY terminal after resume** — the exact trust surface the relay already exposes for every line. A metadata-only launcher leaks nothing the relay doesn't already expose, so it can land without the scoped-tokens prerequisite that blocks the chat view.

## Proposal outline

- **Read-only transcript scan (server, small).** `src/transcripts.js` walks `~/.claude/projects/*/*.jsonl`, returning per file `{ id (uuid = filename), cwd, gitBranch, mtimeMs, title }`. `title` = the first `type:"user"` entry's `message.content` — read only the head of each file, never the whole thing (files run 200KB–3MB). Sort by `mtimeMs`. Expose as `GET /api/transcripts` (token-gated like the rest of `/api`). No board involvement — this is pure filesystem read in the web tier.
- **Resume = the existing spawn path (server, trivial).** `new` already accepts a `run` field. Resuming is `POST /api/sessions { command: "claude --resume <id>", cwd: <transcript cwd> }` — no new spawn code. Optionally a thin `POST /api/transcripts/:id/resume` convenience that looks up the transcript's `cwd` and forwards to the existing create, so the client doesn't have to echo cwd back.
- **Client (medium).** A "Transcripts" (or "Resume a session") section in `SessionsScreen`, **grouped by project** (the `<cwd-slug>` directory), each row showing title + branch + relative time, with a Resume button. Deliberately separate from the live-session cards.

## Risks / open questions

- **Live-vs-dormant dedup.** A running Claude line *also* has a JSONL, so it would appear in both the active list and the transcript list. Filtering it out requires knowing a live line's `sessionId` — which is exactly what `2026-07-07-hook-beaconed-session-state.md` captures (SessionStart beacon stores `transcriptPath`/id per line). Without that binding, dedup falls back to cwd+recency guessing, the thing the transcript docs explicitly avoid. **This feature leans on the hook-beacon issue for a clean dedup.** (It can ship without it — accepting that currently-live sessions show in both lists — but the beacon is the honest version.)
- **Concurrent-resume footgun.** Resuming a session that is *already* live (in another relay line, or a desktop Claude Code window) puts two processes on one session. Resume must be blocked when the id is currently live — which again wants the id binding above.
- **`--resume` semantics — verify, don't assume (claude-code-guide-shaped).** Open before committing to the interaction model: does `claude --resume <id>` continue the *same* session id (append to the same transcript) or fork a new one? Does it require the original cwd? Interactive vs. headless behavior in a PTY? The answer decides whether a resumed transcript's list entry *becomes* the live line (same id) or spawns a sibling (new id) — and whether the list needs to re-point after resume.
- **Scale / UX.** A flat global list of hundreds is unusable. Group by project, sort by last-activity, lazy-load titles (head-read only). Consider a per-project cap + "show older".
- **Format coupling.** Same caveat as `claude-native-lines`: undocumented on-disk format (entries carry `version`, e.g. `2.1.200`, but no compatibility promise). The scanner must degrade gracefully — a file that won't parse is simply omitted from the list, never a 500.
- **Stale/foreign transcripts.** Transcripts exist for projects on other machines / deleted cwds. Resuming into a cwd that no longer exists must fail cleanly (the spawn's `cwd` won't resolve). Surface those as non-resumable rather than letting the spawn error leak.

## Trigger signals to prioritize

- Wanting to pick a past conversation back up **from the phone** — the concrete driver. If that itch is real, this is the cheapest path to it.
- `2026-07-07-hook-beaconed-session-state.md` has landed (gives clean live-vs-dormant dedup and the concurrent-resume guard for near-free).
- Run the `--resume` semantics + dedup through a grill/PRD pass first — both are ADR-shaped (the resume interaction model especially).

## Relationship to other issues

- **`2026-07-02-claude-native-lines.md`** — sibling, opposite set. That reads/renders the transcript of a *live* line (chat view, content in the browser, privacy-gated). This lists *dormant* transcripts and *relaunches* them (metadata only, content stays in the PTY, not privacy-gated). They share the JSONL format knowledge; they don't overlap in code or risk.
- **`2026-07-07-hook-beaconed-session-state.md`** — prerequisite for clean dedup and the concurrent-resume guard (supplies line id ↔ sessionId/transcriptPath binding).
