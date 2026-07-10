# PRD — Desktop shell v1: shell split + master–detail workspace

## Problem Statement

The relay's client has one UI: the phone-shaped `login → sessions → terminal` screen stack — one screen at a time, tap-sized cards, a single terminal filling the viewport. On a desktop browser that shape wastes everything a desktop offers: screen space (several sessions visible at once), a physical keyboard (fast switching), and an always-open tab (a notification surface that needs no push infrastructure). Operators running two or more agent sessions locally alt-tab through the sessions screen to check on each one, and a session silently blocking on a prompt goes unnoticed until the operator happens to look.

## Solution

Split the client into two shells over the one shared core, selected per browser window at load time by window shape. Phone-shaped windows (portrait, or narrower than 768 CSS px — which is exactly what the phone-over-RDP launcher window looks like) keep the existing phone UI, untouched. Everything else gets a workspace: a persistent sidebar listing every session with its live attention state, a terminal pane beside it, Alt+1..9 to jump between sessions, and opt-in browser notifications when a session needs input while the operator is looking elsewhere. A manual toggle in both shells corrects any misclassified window, and the choice sticks for that window without leaking to others.

## User Stories

1. As a desktop operator, I want the app to open as a sidebar + terminal workspace in a wide window, so that I stop paging through phone screens on a monitor.
2. As a phone-over-RDP operator, I want the phone-shaped RDP app window to keep getting the phone UI automatically, so that the tested phone recipe keeps working with zero reconfiguration.
3. As an operator with a misclassified window, I want a shell toggle reachable from either shell, so that one click fixes the classification.
4. As an operator, I want my manual shell choice to persist for that window across reloads but never affect other windows, so that forcing desktop at my desk can't break the phone-RDP window.
5. As an operator, I want the shell decided once per window load — never swapped mid-session by a resize — so that dragging a window can't tear down my attached terminal.
6. As a desktop operator, I want a persistent session list showing each session's attention state (running / idle / needs-input) updating live, so that I can watch the fleet while working in one session.
7. As a desktop operator, I want recently exited sessions in a collapsed sidebar group with their exit info, so that a crashed agent is visible without hunting.
8. As a desktop operator, I want to switch sessions by clicking a row, so that moving between sessions is one action, not three screens.
9. As a desktop operator, I want Alt+1..9 to jump to the Nth listed session — even while the terminal has keyboard focus, so that switching never requires the mouse.
10. As a desktop operator, I want to filter the session list, so that a long list stays navigable (and Alt+digit follows the filtered order).
11. As a desktop operator, I want to spawn a session from the sidebar using the same create dialog as mobile (templates, model/effort chips included), so that spawning works identically everywhere.
12. As a desktop operator, I want to kill a live session or dismiss a tombstone from the sidebar, so that fleet hygiene doesn't require attaching.
13. As a desktop operator, I want the terminal pane to keep showing a dead session's final output with an exit banner instead of auto-switching, so that I can read the tail before moving on.
14. As a desktop operator, I want find-in-output, transcript download, and copy-selection in the workspace terminal toolbar, so that the terminal QoL features aren't mobile-only.
15. As a desktop operator, I want an opt-in browser notification when a session enters needs-input while the window is unfocused, so that a blocked agent pulls me back without me polling.
16. As a desktop operator, I want clicking that notification to focus the window and select that session, so that answering is one click.
17. As a desktop operator, I want notification permission requested only when I explicitly enable notifications (a bell toggle), so that the app never begs on load.
18. As a desktop operator, I want the workspace to auto-select the most recently active session on load (or show a create-session empty state when there are none), so that the pane is never pointlessly blank.
19. As a mobile operator, I want the phone UI's existing screens and flows completely unchanged, so that this feature is invisible on the phone.
20. As a desktop operator, I want the theme toggle available in the workspace, so that dark/light works everywhere.

## Implementation Decisions

- **Two shells over one shared core** (umbrella decision, `_docs/issues/2026-07-02-desktop-workspace-shell.md`): the existing screens *are* the mobile shell and are not modified beyond two sanctioned changes — the shell-toggle affordance, and the find-bar extraction below (a relocation of debugged chrome into a shared component, with no behavior change on mobile); the desktop shell is a new composition of the same core modules (`useSessions`, `useSessionWS`, `TerminalView`, the DTO/frame types). Features live in their shell — no media-query forks inside components. Anything needing new protocol or server state is out of bounds for a shell (glossary: *Shell*).
- **Shell selection** (glossary: *Shell selection*, *Phone-shaped window*): a pure core module decides `mobile | desktop` from `{ width, height, override }` — mobile iff portrait (height > width) or width < 768, unless an override says otherwise. Decided once per window at boot in the app root; sticky for the window's lifetime. The manual override lives in **`sessionStorage`** (per-window, survives that window's reloads) — deliberately not `localStorage`, which is shared per-origin across windows and would let a desk-side "force desktop" hijack the phone-over-RDP window. Storage is injected so the module stays pure and testable.
- **Desktop shell composition**: a workspace component owning selection state, the Alt+1..9 keydown listener, notification wiring, and the shell toggle; a sidebar (session rows with the existing attention-state dots, filter box, tombstone group, New Session button reusing the existing create dialog and data layer unchanged); a detail pane (interactive `TerminalView` + slim toolbar: find, transcript download, copy selection, kill, connection status). The sidebar and pane consume the same session DTO and 5 s poll the mobile shell uses — one data layer, two compositions.
- **Selection behavior**: on load, auto-select the most recently active live session; zero sessions shows an empty state with a create affordance. Creating a session selects it. A selected session's exit keeps the pane on the dead terminal with an exit banner (scrollback intact); the row moves to the tombstone group; no auto-switch.
- **Tombstone group semantics**: mirrors the mobile screen's existing "Recently exited" section — collapsed by default with the group header (and count) always visible, expanding on click to show the rows with their exit info and dismiss controls. Membership and retention inherit the existing tombstone semantics wholesale (the server's capped recent-exits ring; dismiss removes the tombstone for every client, exactly as on mobile) — this feature invents no retention policy.
- **Session jumping is Alt+1..9** (not Ctrl — browser-reserved for tab switching, pages never see it). One pure predicate maps a keyboard event to a jump index 1..9, shared by the workspace's global listener and `TerminalView`'s xterm custom-key-event handler, so the chord passes through a focused terminal identically. `TerminalView` gains an optional passthrough-predicate prop wired into its existing key handling; no other terminal behavior changes. Jump targets are the sidebar's *visible* (post-filter) rows, top-to-bottom.
- **Find bar extraction**: the find bar (input, IME-composition guard, match readout, prev/next/close) moves out of the mobile terminal screen into a shared chrome component both shells import — it is debugged behavior worth one implementation. All other chrome stays per-shell (umbrella decision); the mobile composer/key-chips stay mobile-only.
- **Notifications are transition-based; the sidebar dot is state-based.** A pure reducer diffs consecutive poll results and returns notification specs for sessions that *entered* needs-input, suppressed entirely while the window is focused; tag = session id so a re-fire replaces rather than stacks. A session already in needs-input when the window loses focus deliberately does **not** notify — the flag arrived while its pulsing dot was on screen; the dot (not a notification) remains the persistent signal, pulsing for as long as the session stays in needs-input regardless of focus. A thin hook wires the reducer to the Notification API: permission requested only from the bell-toggle click (never on load), notification click focuses the window and selects the session. Desktop shell only. No Pushover interplay — phone push and desk notification are different devices and coexist.
- **Styling**: new desktop chrome uses CSS Modules over the existing design-token custom properties (Vite-native, zero new dependencies) — required for `:hover`/`:focus-visible` states inline styles can't express. Existing screens and `@ds` components stay inline-styled.
- **No server changes.** The spectator-attach contract is decided (ADR 0005) but implemented in slice 2; nothing in v1 depends on it beyond not contradicting it.

## Testing Decisions

Tests assert external behavior only, via the repo's existing pattern: pure logic in `client/src/core/` as TypeScript, unit-tested with `node --test` (type stripping runs `.test.ts` directly); chrome components get no DOM harness — non-obvious UI logic must live in a tested core module, with the component as thin wiring. Prior art: `core/sessionGuards.ts`, `core/keyChips.ts`, `core/scrollPill.ts` and their `.test.ts` siblings.

Tested modules (all parallel-safe — pure, no ports/server/board):
- **Shell selection** — the decision matrix: portrait/narrow/wide × override present/absent; storage read/write via an injected fake.
- **Notification rules** — the transition matrix: enter/stay/leave needs-input, focused vs unfocused suppression, multiple sessions transitioning in one poll, tag stability.
- **Jump keys** — chord recognition: Alt+1..9 yes; Ctrl+digit, bare digits, Alt+0, Alt+letter, repeat events no.

New-guard hygiene per repo convention: prove each new test by mutation (break the guarded invariant, watch it fail, revert).

`npm run typecheck --workspace=client` must stay green (the core seam is typed). Full-app verification (shell boots into the right composition, Alt+digit switches, notification fires) is browser-driven against the dev servers — that verification is `exclusive` runtime (needs :3017/:5173 and a live board); all unit-test work is `parallel-safe`.

## Out of Scope

- Command palette (deferred to slice 2 — sidebar filter covers v1 switching).
- Spectator attach, PTY dims in `list`, pane grids, split view (slice 2, per ADR 0005 — decided, not built).
- Broadcast input, local-trust endpoints, live output previews on rows (slice 3).
- Any server or board change whatsoever.
- Live-responsive shell swapping on resize (boot-time only, by decision).
- Pointer/UA-based shell detection (defeated by phone-over-RDP; geometry only).
- Notifications for `idle` or `exited` transitions (needs-input only in v1).
- Notifying for sessions *already* in needs-input at the moment the window loses focus (no blur-sweep; the persistent sidebar dot covers that case — see Implementation Decisions).
- Pushover suppression/dedupe logic.
- Restyling existing mobile screens or `@ds` components with CSS Modules.

## Further Notes

- The phone-over-RDP window is the load-bearing edge case: it is desktop Chrome with a mouse at phone geometry. Every detection decision above (geometry-only heuristic, per-window `sessionStorage` override, boot-time stickiness) exists to keep that path correct — regressing it breaks the operator's tested work-from-phone recipe (`_docs/rdp-mobile-recipe.md`).
- ADR 0005 (spectator attach) was written during this feature's grill so v1's layout can't accidentally fight slice 2's contract; v1 must not build anything that assumes interactive-attach-per-visible-session beyond the single detail pane.
- The existing mobile terminal screen already defaults its composer hidden on fine-pointer devices via a `pointer: coarse` check — that check stays as-is (it gates a widget, not a shell).
- Alt+digit browser conflicts checked: unreserved in Chrome/Edge on Windows; bare-Alt menu focus doesn't trigger on chorded Alt+digit.
- Known and accepted `sessionStorage` edge: duplicating a tab clones its sessionStorage, so a duplicated window inherits the original's manual shell override — acceptable (duplicating a desktop-forced window and getting the desktop shell is arguably the expected outcome). The load-bearing phone-over-RDP window is OS-launched — a fresh browsing context — so it never inherits an override.
