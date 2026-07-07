# Validation Contract — desktop-shell-v1

Behavioral assertions defining feature-level done, authored implementation-blind from the PRD's user stories before any code exists. `prd-to-briefs` maps each brief to the `VC-n` ids it covers and fails slicing if any assertion is uncovered; `adversarial-review` sweeps promised-vs-delivered against these where present; a future conducted verify stage will record per-assertion status.

## Assertions

**VC-1.** Loading the app in a landscape window at least 768 CSS px wide presents a workspace: a persistent session list beside a terminal area, with no screen-swapping needed to move between sessions.
**VC-2.** Loading the app in a portrait window (taller than wide) or one narrower than 768 CSS px presents the existing phone UI, with its screens and flows behaving as they did before this feature.
**VC-3.** Each shell offers a visible control that switches the window to the other shell immediately.
**VC-4.** After a manual shell switch, reloading that window keeps the chosen shell.
**VC-5.** A manual shell choice made in one browser window has no effect on which shell any other window gets — including windows opened later.
**VC-6.** Resizing a window after load never swaps the shell mid-session.
**VC-7.** The workspace session list shows every live session with its attention state (running / idle / needs-input), updating without a page reload.
**VC-8.** Recently exited sessions appear in a group in the workspace list whose header (with a count) is always visible and which expands on click to show each session's exit info; dismissing one removes it everywhere, exactly as dismissing from the phone UI does.
**VC-9.** Clicking a session row in the workspace attaches the terminal area to that session and replays its prior output.
**VC-10.** Pressing Alt+N (N = 1..9) selects the Nth visible session row — including while the terminal has keyboard focus.
**VC-11.** Typing in the workspace filter narrows the visible rows, and Alt+N then follows the filtered order.
**VC-12.** Creating a session from the workspace uses the same create dialog as the phone UI; on success the new session appears in the list and becomes the selected one.
**VC-13.** Killing a live session from the workspace list moves it to the recently-exited group.
**VC-14.** When the selected session exits, its final output remains readable in the terminal area with a clear exited indication, and the workspace does not switch to another session on its own.
**VC-15.** Find-in-output (with a match-count readout), transcript download, and copy-selection all work from the workspace terminal.
**VC-16.** With notifications enabled and the window unfocused, a session entering needs-input raises a desktop notification naming that session.
**VC-17.** While the window is focused, no notification fires for any transition.
**VC-18.** Clicking a session's notification focuses the window and selects that session in the workspace.
**VC-19.** A session re-entering needs-input replaces its earlier notification rather than stacking a duplicate.
**VC-20.** Notification permission is requested only after the operator explicitly enables notifications from within the workspace — never on page load.
**VC-21.** With zero sessions, the workspace shows an empty state offering session creation; with one or more, the most recently active session is selected automatically on load.
**VC-22.** The theme toggle is available in the workspace and switches between dark and light.
**VC-23.** A session that was already awaiting input before the window lost focus raises no notification — its needs-input indicator in the session list simply keeps pulsing until the session is answered.

## Drift discipline

When a brief legitimately deviates during build (an assumption proved wrong, a story was re-scoped), the assertion it invalidates must be updated or consciously superseded in place using the strike syntax (`SUPERSEDED by <brief-id>: <why>` on the assertion line) — never silently dropped. A superseded assertion is not a coverage gap.
