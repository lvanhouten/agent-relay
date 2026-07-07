# Desktop shell v1 — shell split + master–detail workspace

**Source:** Slice 1 of `2026-07-02-desktop-workspace-shell.md` (the umbrella doc — architecture, reuse inventory, and the React/TypeScript/styling decisions live there), sliced 2026-07-07 after a scoping pass against the current code.
**Status:** 💡 Proposed — 2026-07-07. First slice; entering the feature pipeline.
**Kind:** Enhancement (architectural beachhead)
**Modules:** client only — `App.jsx` (shell selection), new `DesktopShell`, screens untouched as the mobile shell. No server changes.
**Severity:** High value / medium effort.

## Motivation

The umbrella doc's prerequisites are done: the client core is extracted to TypeScript (`useSessionWS`, `useSessions`, `TerminalView`, frame guards in `client/src/core/`, with `TerminalViewMode` already declaring the future `spectator` axis), and attention states (`running`/`idle`/`needs-input`/`exited`) are on the DTO. The desktop shell now arrives as consumer #2 of a proven core — a second entry composition, not an architecture bet. This slice establishes the two-shells-over-one-core split and ships the first desktop-only value: no more screen-swapping, and local notifications.

## Proposal outline

- **Shell selection in `App.jsx`** — viewport-based heuristic + manual override persisted in `localStorage`. **Viewport, not pointer:** the phone-over-RDP path (`_docs/rdp-mobile-recipe.md`) presents as a *narrow desktop browser with a mouse-presenting pointer*, so a `pointer: coarse` query would strand the phone in the desktop shell; width classifies it correctly, and the manual toggle is the escape hatch for a desktop window narrowed to half-screen. The existing `login → sessions → terminal` screens become the mobile shell, untouched. (medium)
- **`DesktopShell` — master–detail** — persistent sidebar (session rows with attention `StatusDot`s, filter, `NewSessionDialog` reused as-is) + one **interactive** `TerminalView` on the right, fed by the same `useSessions` data layer. Single terminal — deliberately no spectator/multi-pane dependency, so nothing touches the server or the clamp. (medium)
- **Keyboard basics** — Ctrl+1..9 session jumping. Command palette (`cmdk`) is optional scope — in only if it stays thin; it can ride slice 2 otherwise. (small)
- **Local notifications** — `new Notification(...)` on a session's transition to `needs-input` (and possibly `running → idle`), driven off the existing 5 s poll in `useSessions`. No VAPID/service-worker/tunnel plumbing — the always-open desktop tab is the delivery channel. Permission prompt UX and dedupe-vs-Pushover (sitting at the desk you'd get phone + browser both) are grill questions. (small)
- **Styling decision comes due** — the umbrella doc deferred the stylesheet story to desktop-shell build start, which is now: inline styles + tokens can't express hover/focus-visible; likely CSS modules over the existing token custom properties. Decide in the grill, capture as ADR if it's repo-wide. (design)
- **Spectator contract: decide here, build in slice 2** — the ADR for the spectator-attach contract (`2026-07-07-desktop-spectator-panes.md`) should be written during this slice's grill so the shell's layout/composition doesn't fight it later. Cheap now, expensive to retrofit.

## Risks / open questions

- Shell detection misclassification is the UX cliff — the `localStorage` override must be reachable from *both* shells.
- Keep the shell thin (umbrella rule): if anything here wants new protocol or server state, it belongs in core + an issue doc, not inside `DesktopShell`.
- Notification spam: a fleet of sessions going idle at once shouldn't fire N toasts — batch or cap.

## Trigger signals to prioritize

- Trigger already fired (2026-07-06 scoping): running 2+ local sessions and alt-tabbing between them via the sessions screen.
