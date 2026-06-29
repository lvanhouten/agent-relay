# Server accepts all connections regardless of the access token

**Source:** Identified during scaffold review (2026-06-29) — original finding "Auth".
**Status:** Deferred — 2026-06-29.
**Kind:** Enhancement
**Modules:** server/auth, server/api, server/ws, client/LoginScreen
**Severity:** High

## What's already been closed

Login screen UI is complete — token field renders, accepts input, and is stored in component state.

## What remains

The token collected in `LoginScreen` is never sent to the server, and the server has no middleware that validates it. Every REST endpoint and WebSocket connection is fully open to anyone who can reach the host.

Affected files:
- `server/index.js` — no auth middleware registered
- `server/src/api.js` — all routes unauthenticated
- `server/src/ws.js` — WS connections accepted without credential check
- `client/src/screens/LoginScreen.jsx` — token captured but unused
- `client/src/api.js` — fetch calls carry no `Authorization` header

## Fix outline

- Choose a token storage strategy on the server: a single static secret read from an env var (`AR_TOKEN`) is sufficient for the self-hosted use case.
- Add Express middleware that checks `Authorization: Bearer <token>` on all `/api/*` routes; return 401 on mismatch.
- Add the same check in `ws.js` on the `connection` event — read the token from the `Authorization` header or a `?token=` query param (browsers can't set headers on WebSocket upgrades).
- In `client/src/api.js`, thread the token through all fetch calls as an `Authorization: Bearer` header.
- In `client/src/screens/LoginScreen.jsx`, pass the validated token up through `onConnect` and store it in `App` state so it's available for all subsequent requests.
- In `useSessionWS` (`TerminalScreen.jsx`), append `?token=<token>` to the WebSocket URL.
- Gate the connect button on the login screen: treat a 401 response as a failed connection attempt with a clear error message.
- Estimated cost: **small** — no third-party auth library needed; pure middleware plumbing.

## Trigger signals to reopen

- Any deployment exposed over a network (Tailscale, ngrok, Cloudflare Tunnel).
- User reports unexpected sessions or commands they didn't issue.
- Before the first non-localhost demo or beta release.

## Repro

1. Start the server (`npm run server`).
2. From any machine that can reach the host, `curl http://<host>:3001/api/sessions` — returns session list with no credentials required.
3. Open a WebSocket to `ws://<host>:3001/sessions/<any-valid-id>` — connection is accepted and full PTY I/O is available.
