# 05 — Desktop workspace

## Agent Brief

**Category:** enhancement
**Summary:** The desktop shell itself: boot-time shell split in the app root, plus the master–detail workspace — persistent session sidebar, terminal detail pane with slim toolbar, Alt+1..9 jumping, shell toggles in both shells.

**Current behavior:**
The app root boots every window into the phone-shaped screen stack (`login → sessions → terminal`), one screen at a time. All session data already flows through the shared core: the sessions data layer (list + 5 s poll + create/kill with its re-entrancy and stale-poll guards), the terminal view (xterm + WS lifecycle + imperative handle with `send`/`serialize`/search methods), the create dialog, and the attention-state DTO (`running` / `idle` / `needs-input` / `exited` with `exitCode`/`reason`).

**Desired behavior:**
Two shells over that one core (glossary: *Shell*, *Shell selection*):

- **Boot split.** At each window's page load — after the existing boot/auth decision resolves — the app root measures the window once, reads the per-window override, and commits to a shell via the selection module from brief 01 (production storage: `sessionStorage`). The choice is sticky for the window's lifetime; resize never swaps it. The mobile shell is the existing screens, unchanged except for a shell-toggle affordance in the sessions screen's header.
- **Workspace layout.** The desktop shell is a master–detail workspace: a persistent sidebar and a terminal detail pane, no screen-swapping. New chrome is styled with CSS Modules over the existing design-token custom properties (the repo's first CSS Modules usage — hover/focus-visible states need it); existing screens and design-system components stay inline-styled.
- **Sidebar.** Every live session as a row: name, attention dot with the same state mapping the mobile cards use (pulsing for `running`, pulsing-attention for `needs-input`, static for `idle`), shell/cwd hints. A filter box narrows rows. A tombstone group mirrors the mobile "Recently exited" section — header with count always visible, collapsed by default, expanding to rows with their `killed` / `exit N` badge and a dismiss control (dismiss reuses the existing kill path, which the server maps to dismissal for every client). A New Session button opens the existing create dialog (templates, model/effort chips) via the existing data layer, unchanged. The sidebar also hosts the shell toggle and the theme toggle.
- **Selection.** On load, auto-select the most recently active live session; with zero sessions, an empty state offering creation. A successful create selects the new session. Clicking a row attaches the detail pane to it (scrollback replays via the existing attach semantics). When the selected session exits, the pane keeps the dead terminal readable with a clear exit banner (code/reason from the DTO) and does not auto-switch; the row moves to the tombstone group. Attaching to a session that turns out to be a tombstone shows the banner state rather than a retry loop (the server already refuses such attaches permanently).
- **Jumping.** A document-level keydown listener maps Alt+1..9 — via brief 03's predicate — to the Nth *visible* (post-filter) sidebar row, top-to-bottom, and selects it. The terminal view is rendered with brief 03's `passthroughKeys` wired to the same predicate, so the chord works while the terminal has focus.
- **Detail toolbar.** Slim, per-shell chrome above the pane: find (brief 04's `FindBar`, wired to the view handle exactly as mobile wires it), transcript download (same serialize + ANSI-strip + filename behavior as mobile), copy selection, kill session, and the connection-status dot. No composer, no key chips — desktop has a keyboard.
- **Shell toggles.** Each shell's control writes the override for *this window* (brief 01's `writeShellOverride`) and swaps the rendered shell immediately, no reload. The toggle must be reachable in both shells (mobile: sessions-screen header; desktop: sidebar).

**Key interfaces:**

- Consumes from brief 01: `ShellKind`, `decideShell`, `readShellOverride`, `writeShellOverride`.
- Consumes from brief 03: `jumpIndexFromKey`, and `TerminalView`'s `passthroughKeys` prop.
- Consumes from brief 04: `FindBar` (`results` / `onQuery` / `onNext` / `onPrev` / `onClose`).
- Consumes unchanged: the sessions data layer hook, `TerminalView` + its imperative handle, the create dialog, the session DTO (including `status`, `exitCode`, `reason`), design tokens.
- Introduces: the desktop shell component tree (workspace, sidebar, detail pane) — brief 06 later adds notification wiring inside it, so keep its composition legible and its selection state ownable from the workspace root (a notification click must be able to select a session).

**Acceptance criteria:**

- [ ] A ≥768 px-wide landscape window boots into the workspace; a portrait or <768 px window boots into the unchanged phone UI (both verified in a real browser).
- [ ] The shell toggle switches immediately in both directions from both shells; after toggling, a reload of that window keeps the choice, while a second window is unaffected and follows the heuristic.
- [ ] Resizing across the boundary after load does not swap shells.
- [ ] Sidebar rows show live attention states (a needs-input flag lands as a pulsing dot within one poll), and the tombstone group shows count collapsed, expands, and dismisses — matching mobile behavior.
- [ ] Clicking a row attaches and replays scrollback; Alt+3 selects the third visible row even while typing in the terminal; with a filter applied, Alt+N follows the filtered order.
- [ ] Create → dialog succeeds → new session appears and is selected; kill from the sidebar → row moves to tombstones; selected session exits → exit banner, no auto-switch.
- [ ] Find (with readout), transcript download, and copy-selection work from the workspace toolbar.
- [ ] Zero sessions shows the empty state with a create affordance; on load with sessions, the most recently active is selected; the theme toggle works in the workspace.
- [ ] All existing client tests, mobile flows, and typecheck stay green; new chrome uses CSS Modules over tokens only.

**Out of scope:**

- Notifications (bell toggle, permission, Notification API) — brief 06 adds them into this shell.
- Command palette, spectator attach, panes/grid, broadcast input (later slices; ADR 0002 is decided but not built — build nothing that assumes more than this single interactive pane).
- Any server or board change; any restyling of mobile screens or design-system components.
- Live-responsive shell swapping on resize.

**Depends on:** 01-shell-selection-core (consumes decideShell/override helpers), 03-jump-keys-and-terminal-passthrough (consumes jumpIndexFromKey + passthroughKeys), 04-find-bar-extraction (consumes FindBar)

**Covers:** VC-1, VC-2, VC-3, VC-4, VC-5, VC-6, VC-7, VC-8, VC-9, VC-10, VC-11, VC-12, VC-13, VC-14, VC-15, VC-21, VC-22

**Runtime:** exclusive
