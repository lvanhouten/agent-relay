# The "relay" name is aspirational: there is no built-in path from another device to this server

**Source:** Feature-gap brainstorm, 2026-07-02 — same-origin made the client honest (#15), but the actual reach-it-from-my-phone story is still "set up a tunnel by hand and transcribe a token".
**Status:** 💡 Proposed — 2026-07-02.
**Kind:** Enhancement
**Modules:** server/index (startup), docs; touches origin/auth posture
**Severity:** Medium–High value — the enabler for every mobile feature in this backlog.

## Motivation

The same-origin model says: you reach a relay by loading the page from it, directly or through a tunnel. The tunnel half is entirely BYO today. Getting a phone connected means installing/configuring cloudflared or Tailscale, finding the URL, then typing a long random token on a soft keyboard. Every mobile-facing idea in this backlog (push notifications need a secure origin; the PWA needs a stable URL to install against) sits behind this. One command and one QR scan should be the whole pairing flow.

## Proposal outline

- `AR_TUNNEL=cloudflared|tailscale` (or a `--tunnel` flag): at startup, spawn the tunnel child process (`cloudflared tunnel --url http://localhost:3017` / `tailscale serve`), parse the public URL from its output, supervise it like the existing graceful-shutdown path in `index.js`. (medium)
- Print a **QR code in the terminal** (`qrcode-terminal`) encoding `https://<public-url>/#token=<token>`; `LoginScreen` reads the fragment, uses it for the login probe, and strips it from the URL. Fragments don't hit server logs or Referer headers, unlike query strings. (small–medium)
- Tailscale-first as the recommended path in docs: the URL is stable (PWA install survives restarts, push subscriptions stay valid) and reachability is limited to the tailnet. Cloudflared quick tunnels are the zero-account fallback but get a fresh public URL per run, which resets the PWA/push story each restart. (docs)
- Verify the origin gate against tunneled origins: same-origin means the page's own origin is the tunnel hostname, so `src/origin.js`'s same-origin check should already pass it — pin that with a test rather than assuming. (small)

## Risks / open questions

- **A cloudflared quick tunnel is a public URL.** The bearer token becomes the sole gate on the open internet. Hard requirements: refuse to start a tunnel under `AR_NO_AUTH=1`, and consider basic rate-limiting on the login probe. The token's entropy is fine; the posture change (localhost → internet-reachable) deserves a loud startup warning.
- QR-in-terminal assumes the operator can see the server console; when the relay runs via the autostart task there is no console. Fallback: an authed `GET /api/pairing-qr` viewable from the already-paired desktop browser, or `npx agent-relay pair` that prints it on demand.
- Token rotation: today an unpinned token regenerates per run, which would invalidate the phone's saved login on every server restart. Pairing pushes toward pinning `AR_TOKEN` (documented) or persisting the generated token — a small posture decision worth an explicit line in the doc.
  - Observed 2026-07-02 (while verifying the client-core extraction): rotation is **silent** in an already-open client. `useSessions`' poll 401s into its keep-stale-list `catch` (indistinguishable from "offline"), and an attached terminal is closed with 1008, which `useSessionWS` correctly treats as permanent — an OFFLINE dot, no retry. There is no re-login affordance short of a full page reload. A paired phone would look "connected but frozen" after every server restart, so pin-or-persist isn't just convenience — it's what keeps the failure from reading as a broken app.

## Trigger signals to prioritize

- First real attempt to use the relay away from the desk.
- Starting work on push notifications (`2026-07-02-hook-driven-push-notifications.md`) — its secure-origin requirement makes this a prerequisite, so sequence them together.
