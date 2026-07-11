# The RD-app path works today but arrives as a shrunken desktop — the phone-shaped setup is undocumented

**Source:** Remote-access investigation, 2026-07-06 — office DNS filter blocks Tailscale, phone VPN enrollment is a heavier IT ask than it looks, so the sanctioned Remote Desktop app became the chosen phone path. It works, but only feels usable after several non-obvious client settings.
**Status:** ✅ Landed — 2026-07-06. The tested recipe is written up in [`_docs/rdp-mobile-recipe.md`](../../rdp-mobile-recipe.md) (phone-shaped resolution + high DPI, touch mode, home-screen icon, chromeless Edge app-mode window, disconnect/no-config expectations, and the RemoteApp dead-end), with a pointer from the README Running section.
**Kind:** Docs
**Modules:** docs only (README / operator notes) — no code
**Severity:** Low effort, high daily-use payoff — this is the difference between "technically reachable" and "actually used from the couch".

## Motivation

The relay's mobile story at the office is: phone → Microsoft RD/Windows App → RDP session on the workstation → relay dashboard in a browser. Out of the box that renders a full desktop crammed into six inches — unreadable text, mouse-pointer emulation, hunting for a browser window. Every fix is a client-side setting or a one-time in-session arrangement, none of which the repo documents. An operator following a short recipe gets an experience close to a native app; one who doesn't concludes the path is unusable.

## Proposal outline

Document (README section or `_docs/` operator note) the tested recipe:

- **Per-connection display settings** in the phone RD app: resolution "Match this device" (or a custom phone-proportioned resolution) with DPI scaling at 150–200%, so the session renders phone-shaped with touch-sized targets. (docs)
- **Touch mode** (direct manipulation) rather than trackpad/pointer mode. (docs)
- **Home-screen icon**: the mobile app can save a specific machine as an icon — confirmed working 2026-07-06 — making entry one tap from the phone home screen. (docs)
- **In-session arrangement**: run the relay as a chromeless Edge app-mode window (`msedge --app=http://localhost:3017`), maximized — no tabs, no address bar; with the dark theme it reads as a native app. Note that the automated, client-aware version of this is its own issue (`2026-07-06-rdp-client-aware-relay-launcher.md`). (docs)
- **Expectations note**: RDP disconnects are harmless — sessions live on the board daemon and scrollback replays on the next attach; the RD path needs no relay configuration at all (localhost, no tunnel, no CORS changes). (docs)

## Risks / open questions

- Settings names/locations drift across RD client releases (the app is mid-rebrand to "Windows App") — keep the recipe principle-first ("phone-shaped resolution, high DPI, touch mode") rather than screenshot-dependent.
- True RemoteApp (app-window-only RDP) was investigated and ruled out: publishing to mobile clients requires RDS/AVD infrastructure; client-Windows registry hacks don't reach the phone app. The recipe should say so, so nobody re-chases it.

## Trigger signals to prioritize

- First week of real phone-via-RDP usage (the settings will be discovered the hard way otherwise).
- Anyone else at PMMC trying the relay over RD — the recipe is the difference between a demo that lands and one that doesn't.
