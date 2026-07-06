## Agent Brief

**Category:** enhancement
**Summary:** REST middleware and WS upgrade gate accept a valid auth cookie as an alternative to the bearer token

**Current behavior:**
`authMiddleware` accepts only `Authorization: Bearer <token>`; the WS hub's connection gate accepts only a `?token=` query parameter on the upgrade URL. A browser must hold the raw token for every request, and the WS URL carries it as a query string.

**Desired behavior:**
Both gates accept **either** credential:

- **REST**: a request passes with a valid bearer token (unchanged, checked first) or, failing that, a valid auth cookie on the `Cookie` header (verified via the auth-cookie module against the signing secret from the credentials store). Everything else stays 401. Under `AR_NO_AUTH=1` all requests pass, as today.
- **WS upgrade**: same either/or — valid `?token=` query param (kept for non-browser clients) or valid auth cookie on the upgrade request's headers. Invalid both → close 1008 'unauthorized', as today. The origin gate still runs first, unchanged.

The bearer path's behavior, timing-safety, and the `checkToken` seam must be preserved byte-for-byte — non-browser clients (VC-14) see no difference.

**Key interfaces:**

- The auth module's `authMiddleware` — gains the cookie fallback; consumes `verify(value, secret)` + `readAuthCookie(header)` + `COOKIE_NAME` from the auth-cookie module and `SIGNING_SECRET` from the credentials-store-backed auth exports.
- The WS hub's gate sequence (origin → credential → session lookup) — the credential step becomes token-or-cookie.
- A small shared helper is acceptable (one place deciding "is this request authenticated?") so REST and WS can't drift.

**Acceptance criteria:**

- [ ] Valid bearer, no cookie → 200 (REST) / attach proceeds (WS).
- [ ] No bearer, valid cookie → 200 (REST) / attach proceeds (WS).
- [ ] No bearer, tampered/expired cookie → 401 (REST) / 1008 (WS).
- [ ] Neither credential → 401 / 1008, exactly as before.
- [ ] `AR_NO_AUTH=1` still bypasses both gates.
- [ ] Existing auth and API test suites pass unmodified where they cover bearer behavior; new cases extend them for the cookie paths.

**Out of scope:**

- Minting cookies (the login endpoint — pairing-endpoints brief).
- Client-side changes to stop sending `?token=` (client-boot-flow brief).
- Origin-policy changes (origin-runtime-allowlist brief).

**Depends on:** 01-credentials-store (SIGNING_SECRET export), 02-auth-cookie (verify/readAuthCookie/COOKIE_NAME)

**Covers:** VC-6, VC-8, VC-14, VC-17

**Runtime:** parallel-safe
