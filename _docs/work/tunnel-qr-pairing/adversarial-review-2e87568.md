# Adversarial Review: Built-in tunnel + QR pairing

**Scope:** whole `feat/tunnel-qr-pairing` branch — new server modules (`credentials.js`, `cookie.js`, `tunnel.js`, `pairing.js`), modified auth/origin/ws/index, new client core (`boot.ts`, `fragmentPairing.ts`, `pairingDisplay.ts`, `api.ts` deltas) + screens. ~3,335 insertions, 33 code files (docs/tests excluded from budget).
**Reviewed:** `82d28f2..2e87568` (no working-tree changes)
**Verdict:** CONCERNS (3 warnings, two at confidence ≥ 50)

Personas run in-context (all files read once): Saboteur, Maintainer, Security Auditor. No conditional specialist summoned — no DB/hot-path surface (Capacity Planner) and no PHI/HIPAA identifiers (Forensic Auditor); this is an auth/infra feature. Promised-vs-delivered sweep run against all 18 live `VC-n` assertions (none superseded) — **all delivered**, no absence findings.

The design is careful and heavily grounded in ADR 0001 / the PRD. The known-accepted properties (token recoverable via the authed pairing endpoint, credential at rest on disk, no login rate-limit, all-or-nothing revocation, two host-only cookies) are ADR/PRD-sanctioned and are **not** reported. What remains is one reliability gap and some maintainability drift in security-sensitive code.

### Warnings

**W1. `safeEqual` duplicated within the same package (`cookie.js` ↔ `auth.js`)** — `server/src/cookie.js:29` · confidence 65

**Status:** ✅ Resolved in <W1_SHA> — see below.
**Resolution:** Accepted as framed (A). Lifted both byte-for-byte copies into a new shared module `server/src/safeCompare.js`; `auth.js` and `cookie.js` now both `require('./safeCompare').safeEqual`, so there is exactly one definition and the token-compare and signature-compare paths can no longer drift. Neither copy was exported, so extraction broke no external consumer. The *board* twin (`board/lib.js`'s `secretEqual`) stays hand-synced — it's an independent standalone package with no dependency on `server/src`; the new module's header documents why it isn't shared too. Closure check: `safeCompare.test.js` covers the shared function directly (incl. a singleton-require assertion), and the divergence hazard is closed structurally — one definition at `server/src/safeCompare.js:16`, two importers. `auth.test.js`/`cookie.test.js` (47 tests) still green, exercising it in situ.

---

`cookie.js` hand-copies `auth.js`'s constant-time `safeEqual` byte-for-byte. The in-code comment justifies this the same way the board's `secretEqual` twin is justified — "an independent package that runs standalone, no dependency on `server/src`." That rationale is real for `board/lib.js` (verified: separate package, `sb`/`mcp-server` standalone) but **false for `cookie.js` ↔ `auth.js`** — both live in `server/src/`, same package, same directory, and `cookie.js` is already required by `auth.js`. There is no dependency reason not to `require('./auth').safeEqual` (or extract a shared `server/src/safeCompare.js` that both import). Failure scenario: a future hardening of the compare (e.g. eliminating the length-leak the comment itself flags) lands in one copy; the auth-token path and the cookie-signature path silently diverge on their timing/rejection behavior. Fix: import one from the other, or lift both to a shared module; keep only the *board* twin hand-synced.

**W2. Pairing-URL format string built in two places** — `server/src/pairing.js:72` · confidence 60
The token-bearing fragment URL `https://${host}/#token=${encodeURIComponent(token)}` is constructed independently in `pairing.js:72` (the `GET /api/pairing` response) and `index.js:77` (the console QR), each doing its own `new URL(...).host` extraction. This is a security-sensitive format — the whole point is *fragment, never query*. Failure scenario: someone "fixes" one site (adds a query param, changes the fragment key, switches to a path) and a device paired via the console QR then diverges from one paired via the in-UI dialog; worse, a half-applied change could move the token to a query string in one path only, defeating the no-logs guarantee. Fix: a single `pairingUrl(tunnelUrl, token)` helper (natural home: `cookie.js`/`pairing.js` or a small shared util) called by both.

**W3. `LoginScreen` ignores the `login()` result and lands on sessions anyway** — `client/src/screens/LoginScreen.jsx:55` · confidence 50
`await login(token); onConnect(origin);` — the boolean from the cookie-exchange is discarded. If the exchange does not set the cookie (204 not returned), the user is still routed to the sessions screen, where `useSessions` immediately fetches **cookie-only** (no bearer) and 401s into the offline-looking state the whole feature exists to prevent. The window is narrow (the same bearer just passed the `/api/sessions` probe one line above), so in practice this needs a token rotation or a login-endpoint fault between the two calls — but the code treats a failure as success rather than surfacing "Could not complete sign-in." Fix: `if (!(await login(token))) { setError('Could not complete sign-in — try again.'); return; }` before `onConnect`.

### Notes

**N1. Dead `ENOENT` sub-expression in the tailscale probe** — `server/src/tunnel.js:108` · confidence 85
`done({ missing: (err && err.code === 'ENOENT') || true })` — `X || true` is unconditionally `true`, so the `ENOENT` check is dead code that reads as if it discriminates the not-installed case from other spawn errors. Behavior matches intent ("any spawn error ⇒ missing", per the comment), so this is cosmetic, but it actively misleads a maintainer into thinking `missing` can be `false` here. Fix: `done({ missing: true })`.

**N2. `resolveToken` is now vestigial** — `server/src/auth.js:17` · confidence 55
`TOKEN`/`TOKEN_GENERATED` come from `loadCredentials` (`auth.js:23-27`); `resolveToken` is no longer in any production path (confirmed: only referenced by tests) and re-implements token generation (`crypto.randomBytes(24).toString('base64url')`) that now also lives in `credentials.js:22` `generateToken`. The comment retains it as a "non-persisted policy reference" and test surface, but a maintainer reading `auth.js` top-down will reasonably assume `resolveToken` is authoritative and be wrong. Fix: either delete it (and its test) now that persistence is the one token model, or add a one-line pointer that it is intentionally unused by production.

**N3. A second `tunnel.start()` orphans the running `tailscale serve` child** — `server/src/tunnel.js:182` · confidence 45
`start()` re-runs preconditions and calls `spawnServe()`, which assigns `child = cp` without killing a pre-existing child. Called twice while already up, the first `serve` process leaks (no `.kill()`, and its `exit`/`error` handlers early-return on the `child !== cp` guard, so it is never reaped by the supervisor either). Current wiring calls `start()` exactly once (`index.js:119`), so realistic `n` is nil — but there is no `start()` idempotency guard or test, and a future "restart tunnel" affordance would trip it. Fix: `if (child || state.state === 'up') return;` at the top of `start()`, or `stop()`-then-start.

### Summary
No critical findings and no unmet promise in the validation contract — the feature is well-built and its risky corners are explicitly reasoned in ADR 0001. The most important items are the two same-package duplications of security-sensitive code (W1 constant-time compare, W2 the fragment-URL format), which are drift hazards precisely where drift is dangerous; W1 should be fixed before merge. W3 is a real but narrow reliability gap worth a two-line guard.

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| W1 | WARNING | 65 | `safeEqual` duplicated cookie.js↔auth.js (same package) | (open) |
| W2 | WARNING | 60 | Pairing-URL format built in pairing.js + index.js | (open) |
| W3 | WARNING | 50 | LoginScreen ignores `login()` failure, routes to sessions | (open) |
| N1 | NOTE | 85 | Dead `ENOENT` sub-expression in tailscale probe | (open) |
| N2 | NOTE | 55 | `resolveToken` vestigial / duplicates `generateToken` | (open) |
| N3 | NOTE | 45 | Second `tunnel.start()` orphans the serve child | (open) |
