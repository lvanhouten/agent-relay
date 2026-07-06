# Connecting from the phone should land on the relay dashboard, not a desktop — and only from the phone

**Source:** Remote-access investigation, 2026-07-06 — with the RD app as the chosen phone path, the last friction is the seconds after connect: find the browser, find the tab, maximize it. The operator also RDPs in from a home desktop, where none of that should happen.
**Status:** ✅ Shipped — 2026-07-06. `rdp-launcher.ps1` (client discrimination + idempotent app-window launch) and `rdp-launcher-install.ps1` (event-triggered task on LocalSessionManager 21/25, interactive principal) landed at the repo root alongside the existing autostart tooling. The desktop-no-op path is verified on a real RDP session (2560×1440 → correctly no-op); the phone-positive path and the live task firing still need a real phone connect to confirm (per the geometry-timing / interactive-session / CLIENTNAME risks below — the launcher logs each decision to `%LOCALAPPDATA%\agent-relay\rdp-launcher.log` to make that verification a log tail). Usage folded into `_docs/rdp-mobile-recipe.md` step 5.
**Kind:** Enhancement
**Modules:** scripts/ (launcher script + scheduled-task installer) — no server or client code
**Severity:** Medium — turns the RD path from "workable" into "one tap to dashboard"; pairs with `2026-07-06-rdp-mobile-session-recipe.md`.

## Motivation

An event-triggered scheduled task can react to RDP session connect/reconnect and launch the relay as a maximized chromeless app window — so the moment the phone connects, the dashboard is the screen. But the same workstation receives RDP from the operator's home desktop, a full-desktop workflow where auto-launching a maximized window would be actively hostile. The launcher must know **where the connection is coming from** and act only for the phone.

## Proposal outline

- **Trigger**: scheduled task on Terminal Services LocalSessionManager events 21 (session logon) and 25 (session reconnect), configured to run as the interactive user, only when logged on. (small)
- **Client discrimination** — two signals, use geometry as primary:
  - **Session geometry**: with the recipe's "match this device" setting, a phone connection produces a narrow/portrait session resolution no desktop client ever would. Rule: primary-screen width below a threshold (or portrait aspect) ⇒ phone. Robust to device renames, requires no lookup. (small)
  - **`CLIENTNAME`**: the session environment carries the RDP client's device name (home desktop sends its machine name; mobile clients send a device name). Useful as a secondary check / allowlist-by-name override; exact strings the iOS/Android clients send must be verified empirically. (small)
- **Action (phone only)**: launch `msedge --app=http://localhost:3017` maximized, unless such a window already exists (no duplicate windows on reconnect — detect an existing app-mode Edge process/window first). Desktop connections: strict no-op. (medium)
- **Deliverable shape**: a PowerShell launcher script plus an install script (`schtasks` / Register-ScheduledTask) in `scripts/`, matching the repo's existing autostart tooling pattern (`start-relay.vbs`). Uninstall path documented. (medium)

## Risks / open questions

- **Event-triggered GUI in the right session**: tasks triggered by session events must be configured to run in the connecting user's interactive session ("run only when user is logged on", same user), or the window launches nowhere. Needs a real-machine test on both connect (21) and reconnect (25) — reconnect after a phone-then-desktop sequence is the case most likely to misfire.
- **Geometry timing**: the session's display metrics may settle slightly after the logon event fires; the script may need a short retry before reading them.
- **`CLIENTNAME` values for mobile clients are unverified** — do not build the primary rule on them; verify and record what the current iOS/Android clients actually send.
- Reconnect resizes: reconnecting from a *different* device reuses the same session with new geometry — the phone rule must evaluate per-event, not per-boot.

## Trigger signals to prioritize

- Immediately after `2026-07-06-rdp-mobile-session-recipe.md` is applied — this automates its in-session arrangement step.
- Any second daily-driver device joining the rotation (tablet), which stresses the client-discrimination rule.
