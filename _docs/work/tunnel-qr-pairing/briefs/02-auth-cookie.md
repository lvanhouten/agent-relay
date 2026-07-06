## Agent Brief

**Category:** enhancement
**Summary:** Stateless HMAC-signed auth-cookie module: mint and verify the browser credential with no server-side store

**Current behavior:**
Browsers authenticate every request with the bearer token held in React state; there is no cookie of any kind. The server has no way to grant a browser durable authentication (see ADR 0001 — the decision this brief implements).

**Desired behavior:**
A new server module owns the auth cookie end to end (per CONTEXT.md this is always called the *auth cookie*, never a "session cookie" — session means a PTY line). It is pure/stateless: no I/O, no clock reads beyond `Date.now()` at mint, secret passed in by the caller.

- **Mint**: produces a cookie value carrying a version tag, a freshly generated random device id, and issued-at, HMAC-SHA256-signed with the signing secret (e.g. `v1.<deviceId>.<issuedAt>.<sig>` — exact encoding is the implementer's choice but must be its own parser, not JSON-in-cookie). The device id is a forward-compat hook for the parked paired-device dashboard: it must be minted from day one.
- **Verify**: recomputes the signature (constant-time compare, mirroring the auth module's `safeEqual` discipline) and enforces expiry server-side from the signed issued-at (~90-day lifetime, one shared constant with the Max-Age below). Returns whether the value is valid plus the extracted device id. Malformed values, bad signatures, wrong versions, and expired issued-ats all verify false — never throw.
- **Set-Cookie assembly**: builds the header value with HttpOnly, SameSite=Strict, Path=/, Max-Age (~90 days), and Secure exactly when the caller says the request arrived over https.
- **Cookie-header parse**: a hand-rolled parse of a `Cookie` request header extracting this module's cookie by name (no new dependency). Cookie name is a module constant (e.g. `ar_auth`).

**Key interfaces:**

- `issue(secret) → string` — a fresh signed cookie value (new random device id each call).
- `verify(value, secret) → { ok: boolean, deviceId: string|null }`.
- `setCookieHeader(value, { secure }) → string` — full Set-Cookie header value with the attributes above.
- `readAuthCookie(cookieHeader) → string|null` — extracts this cookie's value from a raw Cookie header.
- `COOKIE_NAME` exported for consumers/tests.

**Acceptance criteria:**

- [ ] Round-trip: `verify(issue(secret), secret)` is ok and yields a device id that differs between two `issue` calls.
- [ ] Tampering with any segment (device id, issued-at, signature) fails verification.
- [ ] A value signed with a different secret fails verification.
- [ ] An issued-at older than the lifetime fails verification even though the HMAC is valid.
- [ ] Malformed inputs (empty string, missing segments, non-numeric issued-at, unknown version) return not-ok — no throw.
- [ ] `setCookieHeader` includes HttpOnly, SameSite=Strict, Path=/ and Max-Age always; Secure only when asked.
- [ ] `readAuthCookie` finds the cookie among multiple cookies, returns null when absent or the header is undefined.
- [ ] All behavior covered by unit tests in the server's existing `node --test` style.

**Out of scope:**

- Wiring into middleware or the WS gate (sibling brief).
- The login endpoint that calls `issue` (pairing-endpoints brief).
- Any persistence — the secret comes from the caller; this module never touches disk.

**Depends on:** none

**Covers:** VC-6, VC-7

**Runtime:** parallel-safe
