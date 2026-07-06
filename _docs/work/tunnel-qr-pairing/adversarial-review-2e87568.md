# Adversarial Review: Built-in tunnel + QR pairing

**Scope:** whole `feat/tunnel-qr-pairing` branch — new server modules (`credentials.js`, `cookie.js`, `tunnel.js`, `pairing.js`), modified auth/origin/ws/index, new client core (`boot.ts`, `fragmentPairing.ts`, `pairingDisplay.ts`, `api.ts` deltas) + screens. ~3,335 insertions, 33 code files (docs/tests excluded from budget).
**Reviewed:** `82d28f2..2e87568` (no working-tree changes)
**Verdict:** CONCERNS (3 warnings, two at confidence ≥ 50)

Personas run in-context (all files read once): Saboteur, Maintainer, Security Auditor. No conditional specialist summoned — no DB/hot-path surface (Capacity Planner) and no PHI/HIPAA identifiers (Forensic Auditor); this is an auth/infra feature. Promised-vs-delivered sweep run against all 18 live `VC-n` assertions (none superseded) — **all delivered**, no absence findings.

The design is careful and heavily grounded in ADR 0001 / the PRD. The known-accepted properties (token recoverable via the authed pairing endpoint, credential at rest on disk, no login rate-limit, all-or-nothing revocation, two host-only cookies) are ADR/PRD-sanctioned and are **not** reported. What remains is one reliability gap and some maintainability drift in security-sensitive code.

### Warnings

**W1. `safeEqual` duplicated within the same package (`cookie.js` ↔ `auth.js`)** — `server/src/cookie.js:29` · confidence 65

**Status:** ✅ Resolved in 22d4683 — see below.
**Resolution:** Accepted as framed (A). Lifted both byte-for-byte copies into a new shared module `server/src/safeCompare.js`; `auth.js` and `cookie.js` now both `require('./safeCompare').safeEqual`, so there is exactly one definition and the token-compare and signature-compare paths can no longer drift. Neither copy was exported, so extraction broke no external consumer. The *board* twin (`board/lib.js`'s `secretEqual`) stays hand-synced — it's an independent standalone package with no dependency on `server/src`; the new module's header documents why it isn't shared too. Closure check: `safeCompare.test.js` covers the shared function directly (incl. a singleton-require assertion), and the divergence hazard is closed structurally — one definition at `server/src/safeCompare.js:16`, two importers. `auth.test.js`/`cookie.test.js` (47 tests) still green, exercising it in situ.

---

`cookie.js` hand-copies `auth.js`'s constant-time `safeEqual` byte-for-byte. The in-code comment justifies this the same way the board's `secretEqual` twin is justified — "an independent package that runs standalone, no dependency on `server/src`." That rationale is real for `board/lib.js` (verified: separate package, `sb`/`mcp-server` standalone) but **false for `cookie.js` ↔ `auth.js`** — both live in `server/src/`, same package, same directory, and `cookie.js` is already required by `auth.js`. There is no dependency reason not to `require('./auth').safeEqual` (or extract a shared `server/src/safeCompare.js` that both import). Failure scenario: a future hardening of the compare (e.g. eliminating the length-leak the comment itself flags) lands in one copy; the auth-token path and the cookie-signature path silently diverge on their timing/rejection behavior. Fix: import one from the other, or lift both to a shared module; keep only the *board* twin hand-synced.

**W2. Pairing-URL format string built in two places** — `server/src/pairing.js:72` · confidence 60

**Status:** ✅ Resolved in 412fbbf — see below.
**Resolution:** Accepted as framed (A). Introduced a single exported `pairingUrl(tunnelUrl, token)` in `server/src/pairing.js` that formats the token-bearing fragment URL (`https://<host>/#token=<encoded token>`); both call sites now delegate to it — the `GET /api/pairing` handler (was `pairing.js:72`) and `index.js`'s console-QR block (was `index.js:77`). The no-logs guarantee (token in the fragment, never a query string) now lives in exactly one function, so a half-applied "fix" can't move the token to a query string on one path only. `pairing.js` was already required by `index.js`, so no new import graph. Closure check: three new red→green unit tests on the exported `pairingUrl` (fragment placement, percent-encoding, host-with-port) — the export didn't exist before, so they were red; plus the existing `GET /api/pairing` UP test still asserts the identical URL. 14 pairing tests green; `index.js` passes `node --check`.

---

The token-bearing fragment URL `https://${host}/#token=${encodeURIComponent(token)}` is constructed independently in `pairing.js:72` (the `GET /api/pairing` response) and `index.js:77` (the console QR), each doing its own `new URL(...).host` extraction. This is a security-sensitive format — the whole point is *fragment, never query*. Failure scenario: someone "fixes" one site (adds a query param, changes the fragment key, switches to a path) and a device paired via the console QR then diverges from one paired via the in-UI dialog; worse, a half-applied change could move the token to a query string in one path only, defeating the no-logs guarantee. Fix: a single `pairingUrl(tunnelUrl, token)` helper (natural home: `cookie.js`/`pairing.js` or a small shared util) called by both.

**W3. `LoginScreen` ignores the `login()` result and lands on sessions anyway** — `client/src/screens/LoginScreen.jsx:55` · confidence 50

**Status:** ✅ Resolved in 33a8c33 — see below.
**Resolution:** Accepted as framed (A). `connect()` now guards on the `login()` boolean: `if (!(await login(token))) { setError('Could not complete sign-in — try again.'); return; }` before `onConnect(origin)`. A cookie-exchange that returns anything but 204 (e.g. a token rotated between the `/api/sessions` probe and the `/api/login` call) now surfaces an inline error and stays on the login screen, instead of routing to sessions where a cookie-only fetch would 401 into the offline-looking state. Closure check (per this repo's convention, a UI-only change in a JSX screen with no component-render harness is proven by a named guarded code path): the guarded path is `LoginScreen.jsx` `connect()` — the early-return on `!(await login(token))` between the successful bearer probe and `onConnect`. Client test suite green 61/61. Note: `npm run typecheck --workspace=client` is pre-existing-red in this worktree (missing `react` type declarations, all in `src/core/`; identical at the pre-remediation HEAD) — unrelated to this change, and `LoginScreen.jsx` is a screen outside the `src/core` typecheck scope.

---

`await login(token); onConnect(origin);` — the boolean from the cookie-exchange is discarded. If the exchange does not set the cookie (204 not returned), the user is still routed to the sessions screen, where `useSessions` immediately fetches **cookie-only** (no bearer) and 401s into the offline-looking state the whole feature exists to prevent. The window is narrow (the same bearer just passed the `/api/sessions` probe one line above), so in practice this needs a token rotation or a login-endpoint fault between the two calls — but the code treats a failure as success rather than surfacing "Could not complete sign-in." Fix: `if (!(await login(token))) { setError('Could not complete sign-in — try again.'); return; }` before `onConnect`.

### Notes

**N1. Dead `ENOENT` sub-expression in the tailscale probe** — `server/src/tunnel.js:108` · confidence 85

**Status:** ✅ Resolved in 62f7c6a — see below.
**Resolution:** Accepted as framed (A). The `error` handler now reads `done({ missing: true })`, and the comment says plainly that any spawn error is uniformly "missing" (no discrimination) — removing the `|| true` that made the `ENOENT` check dead and misleading. The unused `err` param was dropped. This is behavior-neutral (`X || true` was already always `true`), so there is no red→green to add; closure is the existing ENOENT test — `tailscale binary missing (ENOENT) → down naming install, no serve spawn` (`tunnel.test.js:170`) — which drives this exact `error` path and stays green, plus the change is provably behavior-identical. Tunnel tests 13/13 green.

---

`done({ missing: (err && err.code === 'ENOENT') || true })` — `X || true` is unconditionally `true`, so the `ENOENT` check is dead code that reads as if it discriminates the not-installed case from other spawn errors. Behavior matches intent ("any spawn error ⇒ missing", per the comment), so this is cosmetic, but it actively misleads a maintainer into thinking `missing` can be `false` here. Fix: `done({ missing: true })`.

**N2. `resolveToken` is now vestigial** — `server/src/auth.js:17` · confidence 55

**Status:** ✋ Rejected (with a clarifying comment) in 58f8f04 — see below.
**Resolution:** Rejected as framed (E) on the "delete it" prong, applied the "add a pointer" prong. The cited code is correct: `resolveToken` works and is *intentionally* retained as a non-persisted policy reference + pinned test surface — a documented author decision (the pre-existing block comment plus ADR 0001, which makes the persisted `loadCredentials` token the one live model). Evidence it's non-authoritative and safe: `grep` across the repo shows `resolveToken` is referenced only by `auth.test.js` (never `index.js` or any production module); production `TOKEN`/`TOKEN_GENERATED` derive from `loadCredentials` (`auth.js:23-27`). Deleting the function and its tests would override that documented decision, so I did not — instead I strengthened the comment with an explicit, unmissable first line ("NOT authoritative and NOT on any production path — referenced only by auth.test.js … Read loadCredentials, not this, for the live token model"), closing the "misleads a maintainer reading top-down" concern the reviewer raised. Comment-only, behavior-neutral: no test change; the existing `resolveToken` policy tests stay green.

---

`TOKEN`/`TOKEN_GENERATED` come from `loadCredentials` (`auth.js:23-27`); `resolveToken` is no longer in any production path (confirmed: only referenced by tests) and re-implements token generation (`crypto.randomBytes(24).toString('base64url')`) that now also lives in `credentials.js:22` `generateToken`. The comment retains it as a "non-persisted policy reference" and test surface, but a maintainer reading `auth.js` top-down will reasonably assume `resolveToken` is authoritative and be wrong. Fix: either delete it (and its test) now that persistence is the one token model, or add a one-line pointer that it is intentionally unused by production.

**N3. A second `tunnel.start()` orphans the running `tailscale serve` child** — `server/src/tunnel.js:182` · confidence 45

**Status:** ✅ Resolved in 7b96a44 — see below.
**Resolution:** Re-framed (B). The defect is real (a second `start()` spawns a second `serve` child and orphans the first, whose exit/error handlers early-return on the `child !== cp` guard and so never reap it), and I added an idempotency guard at the top of `start()`. But I did **not** use the reviewer's suggested `if (child || state.state === 'up') return;` — that would silently break a future `stop()`-then-`start()` restart, because `stop()` clears `child`/`backoffTimer` but leaves `state` as `'up'`, so keying on `state.state` would make `start()` no-op forever after the first stop. Instead the guard keys on the live-resource **handles**: `if (child || backoffTimer) return;` — covering both an up child and a pending respawn timer, while still allowing a restart once `stop()` has nulled the handles. Closure check: two red→green tests (a second `start()` while up, and `start()` while a respawn is pending, both assert exactly one serve child — verified failing when the guard is neutralized), plus a `stop()`-then-`start()` test that proves the re-frame — it spawns a second child *despite* `state.state === 'up'`, which the reviewer's state-based guard would have blocked. Tunnel tests 16/16 green.

---

`start()` re-runs preconditions and calls `spawnServe()`, which assigns `child = cp` without killing a pre-existing child. Called twice while already up, the first `serve` process leaks (no `.kill()`, and its `exit`/`error` handlers early-return on the `child !== cp` guard, so it is never reaped by the supervisor either). Current wiring calls `start()` exactly once (`index.js:119`), so realistic `n` is nil — but there is no `start()` idempotency guard or test, and a future "restart tunnel" affordance would trip it. Fix: `if (child || state.state === 'up') return;` at the top of `start()`, or `stop()`-then-start.

### Summary
No critical findings and no unmet promise in the validation contract — the feature is well-built and its risky corners are explicitly reasoned in ADR 0001. The most important items are the two same-package duplications of security-sensitive code (W1 constant-time compare, W2 the fragment-URL format), which are drift hazards precisely where drift is dangerous; W1 should be fixed before merge. W3 is a real but narrow reliability gap worth a two-line guard.

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| ~~W1~~ | WARNING | 65 | `safeEqual` duplicated cookie.js↔auth.js (same package) | ✅ Resolved in 22d4683 (A — shared safeCompare.js) |
| ~~W2~~ | WARNING | 60 | Pairing-URL format built in pairing.js + index.js | ✅ Resolved in 412fbbf (A — single pairingUrl() helper) |
| ~~W3~~ | WARNING | 50 | LoginScreen ignores `login()` failure, routes to sessions | ✅ Resolved in 33a8c33 (A — guard on login() boolean) |
| ~~N1~~ | NOTE | 85 | Dead `ENOENT` sub-expression in tailscale probe | ✅ Resolved in 62f7c6a (A — dropped `\|\| true`) |
| ~~N2~~ | NOTE | 55 | `resolveToken` vestigial / duplicates `generateToken` | ✋ Rejected in 58f8f04 (E — correct + intentional; clarifying comment) |
| ~~N3~~ | NOTE | 45 | Second `tunnel.start()` orphans the serve child | ✅ Resolved in 7b96a44 (B — guard on live handles, not state) |

**What's left:** Resolved 5 (W1, W2, W3, N1, N3) · Rejected 1 (N2) · Deferred 0 · Open 0. All six findings reached a verdict. N2 was rejected on the "delete it" prong with a comment-only clarification (see its Resolution) — behavior-neutral, worth an eye in re-review. The five A/B fixes (W1, W2, W3, N1, N3) are new code the original review never saw; a re-review over the range `2e87568..HEAD` audits them.
