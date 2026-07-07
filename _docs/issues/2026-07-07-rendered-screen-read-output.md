# read_output hands agents a raw PTY stream when they need the rendered screen

**Source:** conduct-feature LINE-OPS hardening session, 2026-07-07 — the Conductor's permission-prompt detection was rebuilt transcript-first precisely because `read_output` is unreliable for TUI state; this issue is the switchboard-side fix that makes the PTY half of that procedure trustworthy.
**Status:** 💡 Proposed — 2026-07-07.
**Kind:** Enhancement
**Modules:** server/sessions (per-Line VT screen), server/api (`read_output` / MCP tool surface), client (optional: card preview reuse)
**Severity:** Medium-high — every agent-driven consumer of `read_output` against a Claude line is currently parsing noise; this is the single seam that makes those reads deterministic.

## Motivation

`read_output` returns the raw PTY byte stream. For plain shells that's fine; for an alt-screen TUI like Claude Code it's structurally the wrong artifact: the app repaints constantly, so the *stream* is ANSI escapes, cursor jumps, and near-duplicate spinner frames, while the thing every consumer actually wants — *what is on the screen right now* — is stable, small, and never returned. The documented consequences (cost a real 44-minute wedge on 2026-07-02):

- An agent reading a Line stalled at a **permission dialog** sees frame smear indistinguishable from mid-build quiet — the exact misread that leaves a prompt unanswered for a stage's whole idle threshold, or fires a needless wedge gate.
- **Bootstrap confirmation** ("did the session come up, did the pointer prompt land") is pattern-matching through repaints.
- **Answering a dialog** is send-and-pray: TUI menus have been observed taking a number keystroke as select-highlighted rather than pick-by-number, and the raw stream makes it hard to read which option is actually highlighted before/after sending.

conduct-feature now works around this with a transcript-first procedure (JSONL stillness + trailing unanswered `tool_use` narrows the state; the PTY read is only the waiting-vs-executing discriminator). That workaround is sound but leaves the discriminator itself — the one moment the PTY is authoritative — running on the noisy artifact.

## Proposal outline

- **Maintain a headless terminal emulator per Line** — feed the PTY bytes through a VT parser (`@xterm/headless` is purpose-built: same engine as the client's xterm, no DOM). The relay already owns the stream; this adds a screen-state sink beside it. (medium)
- **`read_output` gains a rendered mode** — `{ screen: true }` param (or a sibling `read_screen` tool; decide at build time) returning the **rendered grid as plain text**: rows × cols, no escapes, no duplicate frames — exactly what a human sees on `sb join`. Bounded payload regardless of how much churn the stream carried. (small, once the emulator exists)
- **Include cursor/selection facts** — cursor row/col, and the grid text preserves the selection caret (`❯`) — so a consumer can read *which dialog option is highlighted* before sending a keystroke, and verify the selection moved after. This directly resolves the select-highlighted-vs-pick-by-number ambiguity. (small)
- **Facts, not verdicts.** At most a trivial `state: dialog|working|input|unknown` hint derived from screen markers. The deny-class *judgment* and the verbatim command text stay with the consumer (the command comes from the session transcript, which doesn't wrap/truncate — the screen render complements the transcript flow, never replaces it). (design constraint, not a task)
- **Raw mode stays the default** — plain-shell consumers and anything diffing output keep the stream; rendered mode is additive. (design constraint)
- Consumer follow-up once landed: conduct-feature's LINE-OPS updates its tool surface, bootstrap confirmation, waiting-vs-executing discriminator, and pre-send/verify reads to the rendered mode; its FIRST-USE live-tool check validates the real schema. (tracked in the claude-skills repo, not here)

## Risks / open questions

- **Emulator fidelity:** Claude Code uses the alternate screen buffer, wide glyphs, and heavy color; `@xterm/headless` handles these, but validate against a live Claude line before trusting markers like `❯ 1. Yes` survive rendering.
- **Memory per Line:** one emulator instance per Line (scrollback can be near-zero for this use — only the live grid matters). Bound it and lazy-init on first rendered read so plain shells pay nothing.
- **Sizing:** grid dims must track the PTY resize events or the render shears; the relay already knows the size it allocated.
- **Param vs new tool:** a param keeps the surface small; a new tool keeps schemas single-purpose for MCP consumers. Either way the `sb` CLI should grow the same mode so scripts (not just MCP agents) can consume it.
- **Don't grow a classifier:** the `state` hint is a convenience ceiling, not a feature seed — per-tool status, prompt parsing, and answer automation belong in consumers.

## Trigger signals to prioritize

- Effectively already fired: the 2026-07-02 wedge (44 min lost to unreadable PTY state), and conduct-feature's LINE-OPS now carries a multi-step workaround whose weakest link is exactly this read.
- Fires harder as conducted runs become routine: every stage boundary does bootstrap reads, and every mid-stage permission prompt does a discriminate → confirm → send → verify sequence — four PTY reads per prompt, all on the noisy artifact today.

## Cross-references

- `2026-07-01-session-card-live-preview.md` — the same per-Line rendered screen is the natural feed for card previews; building the emulator once serves both.
- `2026-07-07-hook-beaconed-session-state.md` / `2026-07-02-session-attention-states.md` — attention states say *that* a line needs input; the rendered screen shows *what it is asking*. Complementary layers of the same story.
- `2026-07-02-claude-native-lines.md` — the transcript-tailing bet; this issue is the PTY-side complement (transcript = history + verbatim command text, screen = current UI state).
- `2026-07-01-send-input-bracketed-paste.md` — same tool-surface family; the pre-send highlighted-option read strengthens the input path that issue hardened.
