# Spawning a Claude session always rides the CLI's own defaults — no per-spawn model/effort choice, no relay-level defaults

**Source:** Backlog conversation, 2026-07-02 — while closing out the client-core extraction: "should we have a way to specify a Claude Model / Effort and also have default ones that are used?"
**Status:** 💡 Proposed — 2026-07-02.
**Kind:** Enhancement
**Modules:** client/SessionsScreen (create dialog); later the same store as `2026-07-02-fleet-spawn-templates.md` phase 2
**Severity:** Low — pure convenience today (the command field already accepts flags); grows with fleet usage, where model choice per line is deliberate (cheap watchers vs. a heavy worker).

## Motivation

The `claude` quick-chip in the create dialog spawns whatever the CLI's own config
resolves to. Choosing differently means hand-typing `claude --model opus` (or an
effort override) into the initial-command field — every time, from memory, worst
on a phone keyboard. There is no relay-level notion of "my Claude sessions
default to X", so the CLI's global default silently decides for every line, even
though model/effort is exactly the axis an operator varies when spawning several
lines with different jobs (a cheap `haiku` log-watcher next to an `opus` worker).
Everything needed already flows end-to-end — the command string reaches the PTY
verbatim via `POST /sessions` → `BoardSessions.spawn` → the board's `run` — so
this is a UI + defaults problem, not a protocol change.

## Proposal outline

- Phase 1, client-only: when the `claude` chip is active, the dialog grows model
  and effort selectors (blank = "CLI default", surfaced as such, not as a guess).
  Selections compile into the command string (`claude --model opus …`) shown in
  the existing editable command field — prefill-and-edit, same posture as
  templates, so the compiled flags are visible and fixable before spawn. (small)
- Defaults: a "default model / effort for Claude sessions" setting, applied
  whenever the chip is selected; `localStorage` first, migrating into the
  server-side store when templates phase 2 lands so defaults and templates share
  one persistence story instead of growing two. (small)
- Composition with `2026-07-02-fleet-spawn-templates.md`: a template already
  saves the full command string, so a per-template model rides along for free.
  This feature covers the one-off spawn (no template) and the default; it should
  not grow its own template-like store. (design constraint, no code)
- Selector options are suggestions, not validation: free-text-with-suggestions
  (datalist-style), because a hardcoded model list rots on every Anthropic
  release and the relay must never refuse a model name the CLI would accept. (small)

## Risks / open questions

- **Confirm the CLI surface before building.** `claude --model <name>` is
  established; the effort knob's exact spelling (flag vs. `settings.json` vs.
  env var) varies by CLI version and model tier and must be verified, not
  guessed. Compiling to an editable command string keeps this survivable — a
  changed flag is fixed by typing, not by a client redeploy — but the seeded
  suggestions should track whatever the operator's CLI actually accepts.
- Flag composition: the user may have typed their own `--model` into the command
  field already. Last-writer-wins ambiguity is real; simplest rule is the
  selectors only *prefill* the field and never rewrite text the user has edited
  (same no-silent-rewrite rule as the templates doc's prefill-and-edit).
- Displaying the chosen model on the session card wants per-line metadata the
  DTO doesn't carry — that's `2026-07-02-claude-native-lines.md` territory, not
  this doc. Until then the terminal scrollback itself is the source of truth for
  what actually launched.
- Defaults are operator-wide, not per-project: a cwd-sensitive default ("opus in
  ContractDomain") is a template, not a default — keep the boundary or the two
  features blur.

## Trigger signals to prioritize

- Catching yourself re-typing `--model`/effort flags into the command field.
- Fleet-style usage where different lines deliberately run different models.
- Templates phase 2 landing (the natural home for the defaults store — cheaper
  to add this rider while that store is being built).
