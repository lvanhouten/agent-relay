# 06 — Desktop notifications

## Agent Brief

**Category:** enhancement
**Summary:** Wire the notification reducer to the browser Notification API inside the desktop workspace: opt-in bell toggle, gesture-gated permission, needs-input notifications while unfocused, click-to-focus-and-select.

**Current behavior:**
After briefs 02 and 05: the workspace polls sessions every 5 s and renders attention states, and a pure reducer (`notifyTransitions`) can compute which needs-input transitions deserve a notification — but nothing calls it, and the app never touches the Notification API.

**Desired behavior:**
Local browser notifications as the desktop shell's pull-back channel (transition-based; the pulsing sidebar dot remains the persistent state-based signal):

- **Bell toggle** in the workspace chrome. Enabling it is the *only* place notification permission is ever requested — never on page load. If permission comes back denied, the toggle reflects an unavailable/denied state rather than pretending to be on. The enabled flag persists in `localStorage` (permission is origin-global anyway, and the mobile shell never notifies, so cross-window sharing is harmless — unlike the shell override).
- **Firing.** While enabled and permission is granted, each poll update runs the reducer over (previous list, new list, current window focus); every returned spec becomes a Notification with the spec's `tag` (the session id — so a re-flagged session replaces its prior notification instead of stacking), a title/body naming the session.
- **Click** on a notification focuses the window and selects that session in the workspace, then closes the notification.
- **Suppression semantics come from the reducer, not ad-hoc checks**: focused window → nothing fires; a session already in needs-input when focus is lost → nothing fires (its dot keeps pulsing — deliberate, VC-23).
- Desktop shell only; the mobile shell gets no notification code paths.

**Key interfaces:**

- Consumes from brief 02: `notifyTransitions`, `NotificationSpec` (tag = session id).
- Consumes from brief 05: the workspace's selection ownership (a notification click selects a session by id) and its poll data flow.
- Introduces: a thin notifications hook/wiring living with the desktop shell — all decision logic stays in the tested reducer; the hook is wiring only (permission state, Notification construction, click handler).

**Acceptance criteria:**

- [ ] Loading the app never prompts for notification permission; clicking the bell does (verified in a real browser).
- [ ] With notifications enabled and the window unfocused, flagging a session needs-input (e.g. via the existing notify endpoint) raises a desktop notification naming that session within one poll interval.
- [ ] With the window focused, the same flag produces no notification — only the pulsing sidebar dot.
- [ ] A session already needs-input before the window loses focus produces no notification after blur; its dot keeps pulsing.
- [ ] Clicking the notification focuses the window and the workspace shows that session selected.
- [ ] Re-flagging the same session replaces its notification (same tag) rather than adding a second.
- [ ] Permission denied leaves the toggle visibly off/unavailable and produces no errors; existing client tests and typecheck stay green.

**Out of scope:**

- Any change to the reducer's rules (brief 02 owns them) or to how needs-input is produced/cleared server-side.
- Notifications for idle/exited transitions, blur-time sweeps, batching beyond tag-replacement.
- Web Push, service workers, VAPID, Pushover interplay (separate backlog features).
- Mobile-shell notification affordances.

**Depends on:** 02-notify-rules-core (consumes notifyTransitions/NotificationSpec), 05-desktop-workspace (wires inside the workspace; needs its selection ownership)

**Covers:** VC-16, VC-17, VC-18, VC-19, VC-20, VC-23

**Runtime:** exclusive
