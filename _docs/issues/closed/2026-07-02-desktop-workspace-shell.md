# The desktop browser gets the phone UI — real estate, keyboard, and the always-open tab are all unused

**Source:** Feature-gap brainstorm, 2026-07-02 — local-desktop and remote-phone are two products sharing a kernel; today both get the phone-shaped one: one screen at a time, tap-sized cards, a single terminal filling the viewport.
**Status:** 📐 Sliced — 2026-07-07. This is now the umbrella/architecture doc; the buildable work lives in three slice docs (see *Slicing* below). The core-extraction prerequisite landed (client core in TypeScript under `client/src/core/`, `spectator` mode declared in `types.ts`), and the clamp analysis was verified against the board (sizes keyed per control socket, cleaned on close — a client that never sends `resize` never enters the clamp).
**Kind:** Enhancement (architectural)
**Modules:** client (shell split), server/ws (spectator attach)
**Severity:** High value / medium-high effort — the desktop counterpart to the mobile line of the backlog.

## Motivation

The `login → sessions → terminal` navigation in `App.jsx` is the right shape for a phone and the wrong one for a desktop command center. Desktop's actual advantages — screen space (several sessions at once), a physical keyboard (palette, shortcuts), an always-open tab (local notifications) — have no surface to land on. Meanwhile the shareable core is already cleanly extracted: `useSessionWS`, `wsFrame.js`, `api.js`, `hostTrust.js`, and the design-system components are all shell-agnostic.

## Proposal outline

**Architecture: two shells over one shared core** — not responsive CSS. The current navigation *is* the mobile shell; the desktop shell is a different composition of the same parts. Select by pointer/viewport with a manual override. Features live in their shell (composer bar → mobile, pane grid → desktop) instead of behind media queries. The surviving argument is composition, not bundle size (xterm dwarfs everything): a palette/pane workspace and a screen-stack navigation forced through one adaptive tree turn every feature into a conditional.

**Sequencing that defuses the big-decision risk:** extract the shared core first (`2026-07-02-extract-client-core.md` — `useSessionWS`, `useSessions`, `TerminalView`, in TypeScript) as a pure refactor. The desktop shell then arrives as consumer #2 of a proven core, and the shell split stops being an upfront architecture bet — it's a second entry composition. The only piece needing genuine design before that is the spectator dims contract below, since it touches the board's `list` reply. (design)

## Slicing (2026-07-07)

The build order below is sliced into three independently-pipelined features:

1. **`2026-07-07-desktop-shell-v1-master-detail.md`** — shell split (viewport heuristic + `localStorage` override), sidebar master–detail, Ctrl+1..9, local notifications. Client-only. The spectator ADR is *decided* during this slice's grill, built in slice 2.
2. **`2026-07-07-desktop-spectator-panes.md`** — spectator attach (PTY dims in the board's `list`, `?mode=spectator` no-input/no-resize at the web tier, `TerminalView` spectator mode) + the pane grid. The only server-touching slice.
3. **`2026-07-07-desktop-fleet-extras.md`** — broadcast input, local-trust conveniences, and the live-preview card tail (absorbs `2026-07-01-session-card-live-preview.md`). Items ship independently.

In rough build order (kept for the reasoning; the slice docs are the actionable versions):

- **Sidebar + master–detail** — persistent session list left, terminal right; no more screen-swapping. (medium)
- **Spectator attach** — the prerequisite for anything multi-pane: the board clamps a mirrored line to its *smallest* client, so a grid of small panes would resize every session's PTY to mini dimensions and garble the layout for the agent running in it. And it's not just "don't send resize": a spectator's local xterm still has *some* column count, and if it differs from the PTY's real dims, cursor-positioning output from full-screen TUIs (Claude Code's own UI — exactly what you'd be watching) garbles locally. The clean render is thumbnail-style: set the local terminal to the PTY's actual cols/rows and CSS-scale the canvas to fit the pane. That needs the PTY dims client-side — the board knows them; the `list` reply should carry `cols`/`rows`. So the contract has two halves: server (attach that never participates in sizing, through `src/ws.js`'s `resize` path; dims in `list`) and client (`TerminalView`'s `spectator` mode — adopt reported dims + scale, declared as a type in the core extraction). Read-only scoped tokens (`2026-07-02-scoped-tokens.md`) want identical no-input/no-resize semantics — one design, two consumers. (medium)
- **Split panes / grid** — 2+ live terminals side by side, each a spectator attach until focused (the focused pane owns sizing). Watching a fleet run is the desktop killer feature. (medium-large)
- **Command palette + shortcuts** — Ctrl+K fuzzy session switch / spawn-from-template / kill / copy cwd; Ctrl+1..9 session jumping. (medium)
- **Local notifications** — the always-open tab fires `new Notification(...)` off the attention-state substrate (`2026-07-02-session-attention-states.md`); no VAPID/tunnel/SW plumbing. 80% of the notification value for the local use case, far ahead of the remote push stack — noted as phase 0 in `2026-07-02-hook-driven-push-notifications.md`. (small, after attention states)
- **Broadcast input** — select N sessions, type once (tmux `synchronize-panes`); niche until fleet workflows, which the full-repo-audit pattern already is. (small, after grid)
- **Local-trust conveniences** — cwd autocomplete/browse endpoint for the spawn form, installed-shell enumeration, "open cwd in Explorer/VS Code" links. Each is an authed endpoint that only makes sense same-machine. (small each)

## Decisions (2026-07-02 tradeoff discussion)

- **Reuse inventory** (grounded in the actual screens): *shared* — `useSessionWS` (reconnect/backoff/frame guards, already a self-contained hook), the sessions data layer (poll sequence guard, kill-suppression set, W2/W4 re-entrancy refs — the code least safe to fork), and the xterm mount dance (refs bridge, font-load refit, padding constraint, reset-on-reconnect) as a `<TerminalView>`. *Deliberately per-shell* — chrome: headers, card grid vs. sidebar rows, footer strip; thin presentational JSX over the same DTO and DS parts, cheap to duplicate and where the shells *should* differ. `NewSessionDialog` is shape-agnostic and shared as-is (templates extend it once for both shells).
- **UI framework: stay on React.** Evaluated switching (Svelte 5 / Solid are genuinely better at imperative integrations like xterm+WS, and the repo's worst client bugs — commit-lag re-entrancy, the refs bridge — are React-specific pathologies). Rejected because: those pathologies are already debugged and about to be fenced behind the core seams, so a rewrite re-derives hard-won logic in a new framework's failure modes; the desktop shell is where ecosystem matters most and React's workspace ecosystem is uniquely strong (`dockview`/`react-resizable-panels` for panes, `cmdk` for the palette, Radix if the DS needs real overlays); and this repo is substantially agent-developed, where React is the most reliable target. Don't hand-roll a docking layout — adopt one of those libraries when the grid lands.
- **TypeScript for the extracted core only** (`2026-07-02-extract-client-core.md`): pins the DTO, frame types, and `TerminalView`'s mode axis at the seam. Shells stay JSX; server stays CommonJS-no-build by design.
- **Styling: revisit at desktop-shell build start, not before.** Inline styles + tokens are fine for current surfaces but can't express hover/focus-visible/media queries; the workspace shell's stylesheet story (likely CSS modules over the existing tokens) is a decision for when that work begins.

## Risks / open questions

- The spectator-attach contract is the one piece that touches the server; get it right first or every pane feature fights the clamp. Everything else is client composition.
- The live-preview grid idea (`2026-07-01-session-card-live-preview.md`) is really a desktop-shell feature — and the clamp problem is a second argument for that doc's "tail in the `list` reply" approach over real mini-attaches (text tails can't resize anything and don't cost N data-pipe sockets).
- Shell detection needs an escape hatch (a desktop window narrowed to half-screen shouldn't strand you in the phone shell) — manual toggle persisted in `localStorage`.
- Keep the shells thin: if a feature needs new protocol or server state, it belongs in the shared core with an issue doc, not inside a shell.

## Trigger signals to prioritize

- Running 2+ sessions locally and alt-tabbing between them via the sessions screen.
- Starting the pane/preview work — the spectator-attach decision should be made (and ADR'd) before the first multi-pane feature, not during.
