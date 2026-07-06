# Remediation Verification: tunnel-qr-pairing — `2e87568..c14d75e`

**Verifies:** `_docs/work/tunnel-qr-pairing/adversarial-review-2e87568.md`
**Range:** `2e87568..c14d75e` (remediation checked out in worktree `agent-a32ac84ae7725000f`; not on `feat/tunnel-qr-pairing`, whose HEAD is `a1375f7`)
**Verdict:** CLEARED

Independent re-review of the six-finding remediation. Personas run in-context (fix diff is ~258 lines, 6 code files + tests — well under the split threshold): Saboteur, Maintainer, Security Auditor. No specialist triggered by the fix surface. Each Resolution was treated as a claim to falsify, not intent to absorb. Tests were run at the fix head (worktree), not trusted from the Resolutions.

### Close-out (original findings)

| Orig ID | Claimed | Verify verdict | Evidence |
|---------|---------|----------------|----------|
| W1 | Resolved (A) | ✅ Confirmed closed | `safeEqual` now has exactly one definition (`server/src/safeCompare.js:16`, byte-identical to both removed copies) and two importers (`auth.js:4`, `cookie.js:16`). Grep at fix head finds no other definition and no test importing `safeEqual` from auth/cookie, so extraction broke no consumer. `safeCompare.test.js` asserts singleton reference identity (`require('./safeCompare').safeEqual === safeEqual`); 66 server tests green. Drift hazard closed structurally. |
| W2 | Resolved (A) | ✅ Confirmed closed | Single exported `pairingUrl(tunnelUrl, token)` at `pairing.js:52`; both sites delegate — the `GET /api/pairing` handler and `index.js:79`'s console QR (`const url = pairingUrl(event.url, TOKEN)`). Format byte-identical (`https://<host>/#token=<encoded>`), token in fragment. No shadowing: the handler's local was renamed `pairingUrl`→`url`. Pairing tests assert `#token=` placement, no `?`, and host — green. |
| W3 | Resolved (A) | ✅ Confirmed closed | Falsified the load-bearing dependency: `api.ts` `login()` returns `res.status === 204` — a real boolean, not `undefined`-on-success. So `if (!(await login(token))) { setError(...); return; }` at `LoginScreen.jsx:57` genuinely gates `onConnect`. A non-204 exchange now stays on the login screen with an inline error instead of routing to a cookie-only 401. |
| N1 | Resolved (A) | ✅ Confirmed closed | `error` handler now `done({ missing: true })`, dead `\|\| true` and unused `err` dropped. Behavior-neutral (`X \|\| true` was always `true`); the existing ENOENT test drives this exact path and stays green. Misleading dead sub-expression gone. |
| N2 | Rejected (E) | ✅ Reject justified | Falsified the "still used" possibility: grep at fix head shows `resolveToken` referenced only by its own def/export in `auth.js` and by `auth.test.js` — never `index.js` or any production module; live `TOKEN`/`TOKEN_GENERATED` derive from `loadCredentials`. The finding is a maintainability note, not a defect, so there is no hidden defect a reject could bury. The "delete" prong was declined against a documented author decision (ADR 0001); the "add a pointer" prong was applied — the comment now leads with "NOT authoritative and NOT on any production path." Comment-only, behavior-neutral. |
| N3 | Resolved (B) | ✅ Confirmed closed; re-frame holds | Falsified the re-frame's premise by reading `stop()`: it nulls `backoffTimer` and `child` but leaves `state` untouched — so the reviewer's suggested `state.state === 'up'` guard *would* wedge `stop()`→`start()` forever, exactly as the Resolution claims. The shipped guard `if (child \|\| backoffTimer) return;` (`tunnel.js:240`) covers both a live child and a pending respawn timer while still permitting restart once `stop()` has nulled the handles. Three tests confirm and are non-vacuous (assert "exactly one serve child"; the `stop()`→`start()` restart test specifically exercises the re-frame) — all green. |

### Summary

The remediation can merge. All five A/B fixes are confirmed closed by independent re-derivation plus a green 66-test run at the fix head, and the single E reject (N2) is justified — the cited function is genuinely non-production and the concern was maintainability, not a defect. The new-code sweep over the fix diff found no introduced defect: the `safeEqual` extraction is byte-identical, `pairing.js` avoids the function/local shadow, and the `LoginScreen` guard rests on a `login()` that really returns a boolean. No residue, no regression.

## Priority ranking

_No new findings introduced by the remediation._
