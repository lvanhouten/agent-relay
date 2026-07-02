# The "Relay host" field only governs the login probe — all real traffic is same-origin

**Source:** Came up auditing the client's host/token flow. The login screen lets the operator type a "Relay host", and the initial connection probe fetches from it — but every request after that (session CRUD, the WebSocket PTY stream) targets the browser's own origin, not the typed host.
**Status:** ✅ Resolved — 2026-07-02 (chose same-origin; relabeled the login screen).
**Kind:** Tech-debt
**Modules:** client (api, LoginScreen, TerminalScreen)
**Severity:** Low

## Resolution — same-origin, relabel

Direction chosen: **same-origin only** (over honoring an arbitrary typed host). Rationale: the shipped deployment serves the SPA *from* the relay (or the Vite dev proxy) and tunnels it as one origin, so all traffic is already same-origin; the app uses no cookies (bearer token + `?token=` on the WS), so the "cross-origin cookie" concern in the original fix outline was moot; and honoring a remote host would turn every request cross-origin, fighting the deny-cross-origin-by-default CORS/WS-origin posture added in the secure-defaults change. Honoring the host remains a clean future feature if a static-SPA + separate-backend topology is ever wanted (see triggers below).

Changes:
- `LoginScreen.jsx` — removed the free-text "Relay host" input (and the `ar-host`/`ar-host-trusted` localStorage + untrusted-host gate that went with it). The login probe now fetches the relative `/api/sessions` (same origin, like all other traffic), and the screen shows a read-only "connecting to `<origin>`" indicator. The one credential check kept is the **cleartext gate**: if the page was loaded over `http://` from a non-localhost host, sending the token is gated behind a confirm-and-retry.
- `onConnect` now passes `window.location.origin` up, so the terminal footer's host label reflects the actual (and only) connection target.
- `hostTrust.js` — `isLocalhost`/`normalizeHost` retained (now backing the cleartext gate); comments updated.

Verified end-to-end against a faithful same-origin harness (built SPA + `/api` proxy on one origin): the login screen renders token-only with no host field and an honest "connecting to `<origin>`" line; entering the token and connecting authenticates via the relative probe and lands on the sessions list; no console errors. Client build + 12 client tests pass.

## What's already been closed

Nothing behavioral. Related credential-safety hardening on the login probe (untrusted-host and cleartext warnings before the token is sent) has been done separately, but that governs only the one probe request; the topology mismatch described here remains.

## What remains

`client/src/api.js` uses relative `/api/...` paths (hit the same origin / Vite dev proxy), and `useSessionWS` in `client/src/screens/TerminalScreen.jsx` builds the WebSocket URL from `location.host`. So the "Relay host" the operator types is used only for the one-time login `fetch` in `LoginScreen`; all subsequent traffic ignores it and goes to wherever the SPA is served from. The UI (host label in the terminal footer, the typed field) implies the host is the connection target for everything, which is a trust-boundary/expectation mismatch. Impact is low today because the SPA and its backend are the same origin in the shipped deployment model.

## What remains to decide

Whether the host field *should* be honored for all traffic (making the SPA a true remote client of an arbitrary relay) or whether it should be removed/relabelled to reflect that only same-origin is supported. Both are legitimate product directions.

## Fix outline

- If the host is meant to be authoritative: thread it through `api.js` (absolute base URL) and `useSessionWS` (derive WS host from it, not `location.host`), and handle CORS/cross-origin cookie implications. (medium–large; changes the deployment model)
- If same-origin is the intended model: remove or relabel the host field so it doesn't imply remote-relay capability it doesn't have. (small)
- Cross-cutting risk: honoring an arbitrary host turns every request cross-origin, which interacts with the CORS allowlist and the token-exfil surface — do not do this without the host-trust gating already added to the login probe applying to all traffic.

## Trigger signals to reopen

- A deployment where the SPA is served from a different origin than the relay backend (e.g. static CDN + tunneled backend).
- A user reports that changing the host field "does nothing" after login.
- Any move to a hosted/multi-backend client.

## Repro

Log in with a host, attach to a session, and observe (network panel) that session-list polls and the WebSocket connect to the page's own origin, not the host typed on the login screen.
