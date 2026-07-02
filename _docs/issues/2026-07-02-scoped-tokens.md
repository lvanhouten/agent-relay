# One bearer token grants everything — there is no read-only or per-session access

**Source:** Feature-gap brainstorm, 2026-07-02 — the auth model is all-or-nothing: anyone with the token can spawn shells, type into any session, and kill lines.
**Status:** 💡 Proposed — 2026-07-02.
**Kind:** Enhancement
**Modules:** server/auth, server/ws, server/api
**Severity:** Medium — becomes important the moment access leaves the operator's own devices (tunnel, shared screens, notification actions).

## Motivation

`src/auth.js` resolves exactly one token, and holding it means full control — including typing arbitrary commands into a PTY, i.e. code execution on this machine. That's fine while the only client is the operator's own browser. It stops being fine when: a session view is shared to a second device or person ("watch this run"), a service worker needs a credential to answer a notification (`2026-07-02-notification-action-buttons.md` — caching the full token in a SW over-grants), or the relay is tunnel-exposed (`2026-07-02-tunnel-qr-pairing.md`) and blast-radius starts to matter.

## Proposal outline

- Token classes: `full` (today's token, unchanged), `read` (list + attach, WS input/resize frames dropped server-side), `input:<sessionId>` (single-session input for notification actions). (design)
- Implementation without a token store: HMAC over the scope using the full token as key — `scope.signature` — so scoped tokens are mintable and verifiable statelessly, survive web-tier restarts, and revoke wholesale when the main token rotates. Keep `resolveToken` pure over env (its existing test contract); add a pure `verifyScopedToken(token, scope)` beside it, same constant-time posture as `safeEqual`. (medium)
- Enforcement points: `src/ws.js` tags each connection with its scope at upgrade and filters inbound frames (a `read` connection's `input` frames are dropped, not an error); `src/api.js` gates mutating routes on `full`. Both already funnel through single gates (`checkToken`, `authMiddleware`), so scope threading stays local. (medium)
- Mint UX: an authed `POST /api/tokens` (full-only) returning a scoped token + shareable URL fragment, surfaced later as a "share read-only" button on a session card. (small, after the core)

## Risks / open questions

- Expiry: HMAC tokens are irrevocable individually. Include an `exp` claim in the signed scope (hours for `input:` tokens, longer for `read`) so a leaked scoped token ages out; wholesale revocation remains "rotate the main token".
  - But rotation is currently invisible to a revoked client (observed 2026-07-02): the sessions poll 401s into `useSessions`' keep-stale-list `catch` — the same branch as "server offline" — so the list keeps rendering stale data, and an attached terminal drops to a permanent OFFLINE via the 1008 close. No re-login affordance exists short of a page reload. If rotation is the revocation story, the client side of this feature should distinguish 401 from unreachable in the poll path and route back to the login screen — otherwise "revoked" and "broken" look identical to the person holding the stale token.
- Don't grow a JWT dependency for this — one HMAC + a two-field scope string is the whole need; a parser for someone else's token format is more surface than it saves.
- Read-only still replays the 2000-chunk scrollback — "read" is full observation of everything that session has shown, which can include secrets in output. The share button's copy should say so.

## Trigger signals to prioritize

- Notification action buttons need a SW-side credential (the concrete forcing function).
- First "can I show someone this session" moment, or tunnel exposure making blast-radius reduction worth having.
