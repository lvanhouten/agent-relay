## Agent Brief

**Category:** enhancement
**Summary:** Cookie-era client boot flow: fragment auto-login, ambient-cookie probe, manual login exchanges token for the cookie, WS drops the token query for browsers

**Current behavior:**
The app always boots to the login screen; the token lives in React state and dies with the tab. The login screen probes the sessions list with a bearer header and, on success, passes the token up; every subsequent REST call attaches the bearer header and the WS URL carries `?token=`. A cleartext gate warns (second-click ack) when a manual login would send the token over http from a non-localhost host.

**Desired behavior:**
Boot order (first paint decides among three paths):

1. **Fragment present** (read via the fragment-pairing-core module): strip it from the address bar immediately (history-replace, before any network call), then exchange it at the login endpoint (`POST /api/login`, bearer = fragment token). Success → sessions screen directly, no tap. Failure (rotated token, stale QR) → manual login form with a clear "this pairing link is stale" error.
2. **No fragment**: probe the sessions list with no bearer — the ambient auth cookie authenticates if present (fetches must not disable credentials; same-origin defaults suffice). Success → skip login entirely.
3. **Otherwise**: manual login form, unchanged visually, but on a successful probe it now also calls the login endpoint so the browser leaves with an auth cookie (token no longer needs to live in client state afterwards). The cleartext second-click gate stays exactly as is — and per the PRD it covers the cookie the exchange mints.

After login (any path), REST calls send no bearer header (cookie is ambient) — the token parameter through the app's props/state becomes vestigial and should be removed rather than left half-dead. The WS hook omits the `?token=` query string when no token is supplied; the cookie rides the upgrade. Non-browser use of the token query stays supported server-side (not this brief's concern).

Auth failures after boot (e.g. cookie expired mid-session): a 401 on the poll or a 1008 on attach lands the user back at the login form on next boot — no new in-app re-auth flow is required by this brief (matches current behavior's shape).

**Key interfaces:**

- Consumes `readFragmentToken` / `stripFragment` from the fragment-pairing-core module.
- The client-core fetch wrappers gain `login(token) → Promise<boolean>` (posts to the login endpoint, returns whether a cookie was granted); the existing wrappers' token parameter becomes optional/unused in the browser path.
- The WS hook's token parameter becomes optional; when absent, the upgrade URL has no query string.
- Screen-flow state in the root app component: the `login` screen is skipped when path 1 or 2 succeeds.

**Acceptance criteria:**

- [ ] QR-shaped URL (`…/#token=<valid>`) → sessions screen with no user interaction; address bar shows no token at any point after first paint; reloading keeps the user logged in (cookie).
- [ ] `…/#token=<rotated/stale>` → manual form with a clear stale-pairing error; no redirect loop.
- [ ] Fresh visit with a valid cookie → sessions screen, no login form flash beyond a loading state.
- [ ] Fresh visit with no credential → manual form; successful manual login yields a cookie (subsequent reload skips login).
- [ ] The cleartext second-click gate still triggers on http + non-localhost manual logins.
- [ ] Browser WS attach carries no `?token=`; terminal attach works via cookie (against a server with the dual-auth gate).
- [ ] Logic changes land in the tested core where possible (fetch wrappers, guards); JSX deltas stay thin per repo convention; typecheck green.

**Out of scope:**

- The pair-a-device dialog (sibling brief).
- Server-side anything.
- An in-app re-login modal for mid-session cookie expiry (future QoL).
- localStorage/sessionStorage token persistence (explicitly rejected in favor of the cookie — ADR 0001).

**Depends on:** 03-dual-auth-middleware (cookie-authenticated REST + WS to run against), 05-pairing-endpoints (login endpoint contract), 08-fragment-pairing-core (fragment reader)

**Covers:** VC-3, VC-4, VC-5, VC-7, VC-15

**Runtime:** parallel-safe
