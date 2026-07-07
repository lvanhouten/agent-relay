# Desktop shell v3 — fleet extras: broadcast input, local-trust conveniences, card previews

**Source:** Slice 3 of `2026-07-02-desktop-workspace-shell.md`, sliced 2026-07-07. The small follow-ons that assume the workspace (slice 1) and, for some items, the grid (slice 2) exist.
**Status:** 💡 Proposed — 2026-07-07. A grab-bag by design — items ship independently as their triggers fire; don't pipeline this as one feature.
**Kind:** Enhancement
**Modules:** client (DesktopShell), server/api (local-trust endpoints), board `list` (preview tail)
**Severity:** Nice-to-have / small each.

## Items

- **Broadcast input** — select N sessions, type once (tmux `synchronize-panes` style). Niche until fleet workflows; the full-repo-audit and conduct-feature patterns already are one. Client composition over the existing WS input path — no new protocol. (small, after the grid)
- **Local-trust conveniences** — authed endpoints that only make sense same-machine: cwd autocomplete/browse for the spawn form, installed-shell enumeration, "open cwd in Explorer / VS Code" links on a session row. Each is an independent small endpoint + a sidebar affordance. (small each, after slice 1)
- **Live output preview on cards/rows** — fold-in of `2026-07-01-session-card-live-preview.md`: a short, byte-capped, ANSI-stripped scrollback tail in the board's `list` reply, riding the existing 5 s poll. The right answer for *many small* previews (text tails can't resize anything and don't cost N data-pipe sockets) — complements slice 2's real spectator attaches, which are for a handful of live panes. (medium)

## Risks / open questions

- Broadcast input is a foot-gun (typing into N agents at once) — needs an explicit armed state in the UI, not just multi-select + keystrokes.
- The preview tail bloats every `list` reply for every consumer (`sb`, MCP, web) — cap bytes hard and consider making it opt-in per request.
- Local-trust endpoints widen the authed API surface with filesystem reads (`cwd autocomplete` = directory enumeration with the relay's privileges); they're same-machine conveniences, but a tunnel-exposed relay serves them too — gate on scoped tokens (`2026-07-02-scoped-tokens.md`) or a local-only check if that ever matters.

## Trigger signals to prioritize

- Broadcast: first time you type the same answer into 3 sessions back to back.
- Previews: the sessions list grows enough that "which session is doing what" needs a glance, not an attach (the original doc's trigger).
- Local-trust: friction actually felt in the spawn form (retyping long cwds) or reaching for a session's directory.
