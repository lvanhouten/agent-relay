# The desktop browser gets the phone UI — real estate, keyboard, and the always-open tab are all unused

**Source:** Feature-gap brainstorm, 2026-07-02 — local-desktop and remote-phone are two products sharing a kernel; today both get the phone-shaped one: one screen at a time, tap-sized cards, a single terminal filling the viewport.
**Status:** 💡 Proposed — 2026-07-02.
**Kind:** Enhancement (architectural)
**Modules:** client (shell split), server/ws (spectator attach)
**Severity:** High value / medium-high effort — the desktop counterpart to the mobile line of the backlog.

## Motivation

The `login → sessions → terminal` navigation in `App.jsx` is the right shape for a phone and the wrong one for a desktop command center. Desktop's actual advantages — screen space (several sessions at once), a physical keyboard (palette, shortcuts), an always-open tab (local notifications) — have no surface to land on. Meanwhile the shareable core is already cleanly extracted: `useSessionWS`, `wsFrame.js`, `api.js`, `hostTrust.js`, and the design-system components are all shell-agnostic.

## Proposal outline

**Architecture: two shells over one shared core** — not responsive CSS. The current navigation *is* the mobile shell; the desktop shell is a different composition of the same parts. Select by pointer/viewport with a manual override. Features live in their shell (composer bar → mobile, pane grid → desktop) instead of behind media queries, so the phone bundle never carries a pane manager and desktop never inherits phone ergonomics. This split is ADR-shaped — grill it before building. (design)

In rough build order:

- **Sidebar + master–detail** — persistent session list left, terminal right; no more screen-swapping. (medium)
- **Spectator attach** — the prerequisite for anything multi-pane: the board clamps a mirrored line to its *smallest* client, so a grid of small panes would resize every session's PTY to mini dimensions and garble the layout for the agent running in it. Define an attach that renders output but never participates in sizing (pane-level contract through `src/ws.js`'s `resize` path). Read-only scoped tokens (`2026-07-02-scoped-tokens.md`) want identical semantics — one design, two consumers. (medium)
- **Split panes / grid** — 2+ live terminals side by side, each a spectator attach until focused (the focused pane owns sizing). Watching a fleet run is the desktop killer feature. (medium-large)
- **Command palette + shortcuts** — Ctrl+K fuzzy session switch / spawn-from-template / kill / copy cwd; Ctrl+1..9 session jumping. (medium)
- **Local notifications** — the always-open tab fires `new Notification(...)` off the attention-state substrate (`2026-07-02-session-attention-states.md`); no VAPID/tunnel/SW plumbing. 80% of the notification value for the local use case, far ahead of the remote push stack — noted as phase 0 in `2026-07-02-hook-driven-push-notifications.md`. (small, after attention states)
- **Broadcast input** — select N sessions, type once (tmux `synchronize-panes`); niche until fleet workflows, which the full-repo-audit pattern already is. (small, after grid)
- **Local-trust conveniences** — cwd autocomplete/browse endpoint for the spawn form, installed-shell enumeration, "open cwd in Explorer/VS Code" links. Each is an authed endpoint that only makes sense same-machine. (small each)

## Risks / open questions

- The spectator-attach contract is the one piece that touches the server; get it right first or every pane feature fights the clamp. Everything else is client composition.
- The live-preview grid idea (`2026-07-01-session-card-live-preview.md`) is really a desktop-shell feature — and the clamp problem is a second argument for that doc's "tail in the `list` reply" approach over real mini-attaches (text tails can't resize anything and don't cost N data-pipe sockets).
- Shell detection needs an escape hatch (a desktop window narrowed to half-screen shouldn't strand you in the phone shell) — manual toggle persisted in `localStorage`.
- Keep the shells thin: if a feature needs new protocol or server state, it belongs in the shared core with an issue doc, not inside a shell.

## Trigger signals to prioritize

- Running 2+ sessions locally and alt-tabbing between them via the sessions screen.
- Starting the pane/preview work — the spectator-attach decision should be made (and ADR'd) before the first multi-pane feature, not during.
