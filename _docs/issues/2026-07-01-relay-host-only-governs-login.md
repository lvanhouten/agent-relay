# The "Relay host" field only governs the login probe — all real traffic is same-origin

**Source:** Came up auditing the client's host/token flow. The login screen lets the operator type a "Relay host", and the initial connection probe fetches from it — but every request after that (session CRUD, the WebSocket PTY stream) targets the browser's own origin, not the typed host.
**Status:** ⏸ Deferred — 2026-07-01.
**Kind:** Tech-debt
**Modules:** client (api, LoginScreen, TerminalScreen)
**Severity:** Low

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
