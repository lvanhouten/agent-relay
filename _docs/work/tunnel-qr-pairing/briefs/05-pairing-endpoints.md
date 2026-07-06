## Agent Brief

**Category:** enhancement
**Summary:** Pairing router: bearer-only login endpoint that mints the auth cookie, and an authed pairing endpoint exposing the pairing URL + tunnel status

**Current behavior:**
There is no login endpoint — clients simply attach the bearer header to every call (the login screen probes `GET /api/sessions` to validate a token). There is no way to obtain a pairing URL or ask whether a tunnel is up.

**Desired behavior:**
A new Express router (mounted under the API by the wiring brief) with two endpoints:

- **Login** (`POST /api/login`): demands the bearer token specifically — an ambient auth cookie does NOT satisfy it; this is the only place cookies are minted. Valid bearer → 204 with a Set-Cookie of a freshly issued auth cookie (Secure flag iff the request arrived over https — honor the connection or a proxy-forwarded proto indication consistently). Invalid/missing bearer → 401, no cookie. Requires a JSON-safe posture consistent with the API's existing cross-site defenses (it takes no body; ensure a cross-site form POST can't ride it — same-origin is already enforced by the origin gate + SameSite).
- **Pairing** (`GET /api/pairing`): authed by the normal dual gate (bearer or cookie). Returns tunnel status and, only when the tunnel is up, the pairing URL `https://<tunnel-host>/#token=<access token>` — the token travels in the URL *fragment*, never a query string. Tunnel down → status with its reason and **no** pairing URL (a localhost URL is unreachable from the device being paired). Response shape: `{ tunnel: { state, reason }, pairingUrl }` with `pairingUrl: null` when not up.

Known accepted property (per ADR 0001, PRD): any authenticated caller can recover the token via this endpoint — deliberate for single-operator headless pairing.

**Key interfaces:**

- Router factory taking injected collaborators, matching the API router's style: the token (from the credentials-backed auth exports), `issue`/`setCookieHeader` from the auth-cookie module, and a tunnel-status getter with the tunnel supervisor's status shape `{ state: 'up'|'down'|'disabled', url: string|null, reason: string|null }`.
- The login endpoint must reuse `checkToken` (constant-time) for the bearer comparison, not a fresh compare.

**Acceptance criteria:**

- [ ] `POST /api/login` with valid bearer → 204, Set-Cookie present with HttpOnly/SameSite=Strict/Path=//Max-Age; Secure exactly when the request is https.
- [ ] `POST /api/login` with a valid cookie but no bearer → 401, no Set-Cookie.
- [ ] `POST /api/login` with invalid/missing bearer → 401, no Set-Cookie.
- [ ] `GET /api/pairing` unauthenticated → 401.
- [ ] `GET /api/pairing` authed with tunnel up → pairing URL uses the tunnel host, embeds the token after `#token=`, contains no `?`-style token.
- [ ] `GET /api/pairing` authed with tunnel down/disabled → `pairingUrl` null, status carries the reason.
- [ ] Tests follow the existing API-suite pattern (Express app with injected fakes, supertest-style request assertions).

**Out of scope:**

- Mounting into the real server startup (server-wiring brief).
- The tunnel supervisor itself (its status getter is injected here; the shape is defined by 04-tunnel-supervisor).
- Any client consumption of these endpoints.
- Rate limiting (PRD out-of-scope).

**Depends on:** 01-credentials-store (token source via auth exports), 02-auth-cookie (issue/setCookieHeader), 04-tunnel-supervisor (status shape consumed by the injected getter)

**Covers:** VC-3, VC-9, VC-10

**Runtime:** parallel-safe
