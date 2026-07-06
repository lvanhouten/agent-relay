# Using agent-relay from your phone over Remote Desktop

The relay's mobile story at the office is: **phone → Microsoft Remote Desktop
app → RDP session on your workstation → the relay dashboard in a browser.** No
tunnel, no VPN, no CORS changes, no relay configuration at all — the browser runs
*on* the workstation, so it reaches `localhost:3017` directly.

This path works today, but out of the box it renders a full desktop crammed into
six inches: unreadable text, a floating mouse pointer, and a hunt for the browser
window. Every fix below is a client-side setting or a one-time in-session
arrangement. Follow the recipe once and the result reads like a native app; skip
it and you'll conclude the path is unusable.

> **Why RDP and not the tunnel?** The office network DNS-filters Tailscale, so the
> built-in `AR_TUNNEL=tailscale` path degrades to local-only at work (it's fully
> usable on home/unfiltered networks). RDP is the sanctioned phone path at the
> office. See `_docs/issues/2026-07-06-rdp-mobile-session-recipe.md` for the
> investigation behind this.

## The recipe

Do these in the **Microsoft Remote Desktop** / **Windows App** on your phone
(iOS/Android). Setting names drift across releases — the app is mid-rebrand to
"Windows App" — so match the *principle*, not the exact label.

1. **Phone-shaped resolution + high DPI.** In the connection's display settings,
   set resolution to **"Match this device"** (or a custom phone-proportioned
   resolution like 1170×2532) and DPI/scaling to **150–200%**. This is the single
   biggest win: the Windows session renders tall-and-narrow with touch-sized text
   and controls, instead of a shrunken 1080p desktop.

2. **Touch mode, not pointer mode.** Switch input to **touch / direct
   manipulation** rather than trackpad/mouse-pointer emulation. Tapping then hits
   what you tap; scrolling is a finger drag. (The relay's terminal scrolls fine
   under touch; the scroll-to-bottom pill — `_docs/issues/2026-07-02-terminal-qol.md`
   — is the planned QoL follow-up for long transcripts.)

3. **Home-screen icon.** The app can save a specific machine as a home-screen
   icon (confirmed working 2026-07-06). Add it, and entry is one tap from the
   phone home screen — no app-drawer, no connection picker.

4. **Chromeless relay window (one-time, in-session).** Once connected, launch the
   relay as an Edge **app-mode** window so it fills the screen with no tabs or
   address bar:

   ```
   msedge --app=http://localhost:3017
   ```

   Maximize it. With the relay's dark theme it reads as a native app. Pin that
   command to a desktop shortcut on the workstation so it's a single click each
   session.

5. **Automate step 4 on connect (optional).** Instead of the manual shortcut,
   register the client-aware launcher so the app window opens by itself the moment
   the *phone* connects — and does nothing when you RDP in from a desktop:

   ```
   powershell -ExecutionPolicy Bypass -File rdp-launcher-install.ps1 install
   ```

   It reads the RDP session's geometry (portrait or narrow ⇒ phone) on
   LocalSessionManager connect/reconnect events; a wide landscape desktop session
   is a strict no-op. Tune the rule or exempt a named desktop client, e.g.
   `... install -WidthThreshold 800 -DesktopClientNames HOME-DESKTOP`. Each fire
   logs its decision to `%LOCALAPPDATA%\agent-relay\rdp-launcher.log` — tail it to
   confirm what the iOS/Android client actually reports for geometry and
   `CLIENTNAME` on your devices. Remove with `rdp-launcher-install.ps1 uninstall`
   (an already-open window stays until you close it).

## What you don't need to worry about

- **Disconnects are harmless.** Sessions live on the board daemon, not the RDP
  session — scrollback replays on the next attach. Drop the RDP connection, lock
  your phone, reconnect later; the agent sessions are exactly where you left them.
- **No relay config.** localhost, no tunnel, no `AR_CORS_ORIGIN`, no pairing. The
  browser is on the workstation, so same-origin is automatic.

## What was ruled out (don't re-chase)

- **True RemoteApp** (publishing just the relay window to the phone, no desktop)
  requires RDS/AVD infrastructure to publish to mobile clients; client-Windows
  registry hacks don't reach the phone app. The chromeless-Edge step above is the
  practical substitute.
