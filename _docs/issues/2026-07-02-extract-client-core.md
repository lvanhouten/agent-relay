# The client's hard-won logic is embedded in screen components — extract a shared core (in TypeScript) before a second consumer forks it

**Source:** Shell-split tradeoff discussion, 2026-07-02 — the reuse inventory for the desktop workspace shell (`2026-07-02-desktop-workspace-shell.md`) found the expensive logic is all extractable, and none of it is extracted.
**Status:** 💡 Proposed — 2026-07-02.
**Kind:** Refactor (pure — no behavior change)
**Modules:** client
**Severity:** Medium — prerequisite for the desktop shell, the mobile composer bar, and terminal QoL; valuable even if none of those ship.

## Motivation

Three pieces of debugged, commented, non-obvious logic live inside screen components, where a second consumer can only fork or re-derive them:

- **`useSessionWS`** (`TerminalScreen.jsx:45`) — reconnect with backoff, the 1008/exit permanent-stop conditions, frame-guard integration, reset-before-replay. Already a self-contained hook; wrong file.
- **The sessions data layer** (`SessionsScreen.jsx`) — the poll sequence guard, the `killed` suppression set against stale-poll flicker-back, and the synchronous re-entrancy refs on create/kill (W2/W4). These guards fence React-specific pathologies (state commits lag events); re-implementing polling in a desktop sidebar reintroduces the exact bugs they closed.
- **The xterm mount** (`TerminalScreen.jsx`) — the refs bridge around the exhaustive-deps opt-out, the font-load refit, padding-on-wrapper-not-mount-node, reset-on-reconnect, theme sync.

Every roadmap item that touches the terminal or the session list (desktop shell panes, mobile composer bar, terminal search/download, spectator attach) is a second consumer of one of these.

## Proposal outline

- `client/src/core/`: move `useSessionWS` out of the screen; extract `useSessions(token)` (list + poll + guards + create/kill) from `SessionsScreen`; extract `<TerminalView>` owning xterm, `XTERM_THEMES`, the mount dance, and `useSessionWS` — chrome (header/footer/back) stays in the screen. Screens become thin compositions; behavior byte-identical. (medium)
- **TypeScript for `core/` only.** Vite compiles TS out of the box; shells/screens stay JSX. The point is pinning contracts at the seam: the session DTO, WS frame types (`wsFrame` gains types alongside its guards), and `TerminalView`'s mode axis — `interactive` (fit + send resize) now, `spectator` (adopt reported PTY dims + CSS-scale, never send resize) stubbed as a type so the desktop shell lands against a declared contract. Server stays CommonJS-no-build by design; this decision does not creep there. (small, riding the extraction)
- Tests: keep the repo's convention (pure logic modules under `node --test`, no component harness). The poll sequence guard and kill-suppression logic extract as pure functions beside `wsFrame.js` and gain direct tests — the guards are currently proven only as named guarded code paths. `TerminalView`'s mount effect remains harness-exempt like the screens it came from. (small)

## Risks / open questions

- Pure-refactor discipline: no behavior change, no new features riding along — the diff should be file moves, type annotations, and test additions. Anything else (spectator mode, composer bar) is its own doc.
- The `useSessions` extraction must not loosen the guard semantics: the suppression set and sequence counters are refs precisely so they never retrigger effects — port them as-is, don't "clean them up" into state.
- One-time decision: `core/` module format is ESM `.ts`/`.tsx` (client is already ESM); no `allowJs` gymnastics — files convert as they move.

## Trigger signals to prioritize

- Before starting the desktop workspace shell, the mobile composer bar, or terminal QoL — whichever comes first; each is consumer #2 of a piece of this core.
- Any bugfix touching the WS lifecycle or the poll guards (extract first, fix in the extracted module with a test).
