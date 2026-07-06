# Execution status — tunnel-qr-pairing

**Execution mode:** SEQUENTIAL (one synchronous executor at a time). `isolation: "worktree"`
did not create isolated worktrees in this nested-worktree checkout — the first parallel
wave had all agents sharing one working tree and branch. Recovered cleanly (see Deviations);
remaining briefs run serially, each committing directly onto `feat/tunnel-qr-pairing`, gated
by a rebuild+test after each commit.

| Brief | Status | Wave | Merged SHA | Criteria | Note |
|---|---|---|---|---|---|
| 01-credentials-store | integrated | 1 | 4de311c | 7/7 | report lost to kill; verified via committed tests + green suite |
| 06-origin-runtime-allowlist | integrated | 1 | c344f62 | 5/5 | |
| 08-fragment-pairing-core | integrated | 1 | 1dd8f7b | 5/5 | |
| 02-auth-cookie | integrated | 1 | 204f528 | 8/8 | |
| 04-tunnel-supervisor | integrated | 1 | 5b59759 | 6/6 | monotonic-backoff deviation (see below) — no VC impact |
| 03-dual-auth-middleware | pending | 2 | — | — | |
| 05-pairing-endpoints | pending | 2 | — | — | |
| 09-client-boot-flow | pending | 3 | — | — | |
| 10-pair-device-dialog | pending | 3 | — | — | |
| 07-server-wiring | pending | 4 | — | — | exclusive (boots relay) |

## Handoff notes
- **01-credentials-store → [03, 05, 07]:** `credentials.js` exports `loadCredentials(env, file?) → { token, generated, signingSecret }` and `credentialsPath`. `auth.js` now derives `TOKEN` / `TOKEN_GENERATED` / `SIGNING_SECRET` from `loadCredentials(process.env)` and exports all three (plus `authMiddleware`, `checkToken`, `resolveToken`). Consume `SIGNING_SECRET` from the auth module. (contract-change)
- **06-origin-runtime-allowlist → [07]:** shipped `allowRuntimeOrigin(origin)` on `server/src/origin.js` (module-level Set, idempotent, falsy = no-op). Wiring just calls `require('./origin').allowRuntimeOrigin(tunnelOrigin)` once per discovered URL — no other plumbing. `originAllowed` gained a 4th `runtimeOrigins` param defaulting to that Set. (contract-change)
- **08-fragment-pairing-core → [09]:** `client/src/core/fragmentPairing.ts` exports `readFragmentToken(hash) → string|null` (accepts hash with/without leading `#`; null on junk/empty/other-key/malformed-escape, never throws) and `stripFragment(href) → string` (removes only `#...`, preserves path+query). Neither touches `window`; the boot flow owns reading `location.hash`/`location.href` and the `history.replaceState`. (contract-change)
- **02-auth-cookie → [03, 05]:** `server/src/cookie.js` exports `issue(secret) → string`, `verify(value, secret) → { ok, deviceId }` (never throws), `setCookieHeader(value, { secure }) → string` (HttpOnly; SameSite=Strict; Path=/; Max-Age always; Secure iff `secure`), `readAuthCookie(cookieHeader) → string|null`, `COOKIE_NAME = 'ar_auth'`, plus `LIFETIME_MS`/`MAX_AGE_SECONDS`. Pure — pass `credentials.js`'s `signingSecret` in; it does not import credentials. Encoding `v1.<deviceId>.<issuedAt>.<sig>`. (contract-change)
- **04-tunnel-supervisor → [05, 07]:** `server/src/tunnel.js` exports `createTunnel({ port, env, exec, existsClientBuild, onEvent, scheduler }) → { start(), stop(), status() }`. `status() → { state: 'up'|'down'|'disabled', url: string|null, reason: string|null }` — invariant: `url` is non-null **iff** `state==='up'`. Brief 05 gates the pairing URL on `state==='up'`. `onEvent` emits `{type:'up',url}`, `{type:'degraded',reason}`, `{type:'retry',attempt,delayMs,reason}` (brief 07 turns these into console output). The origin brief 07 registers = `status().url`. (contract-change)

## Deviations
- **04-tunnel-supervisor:** backoff counter is monotonic within a `start()` cycle (reset only by `start()`, not per-spawn) — no readiness signal is available to safely reset it during a rapid spawn-then-die flap. Deterministic under the injected scheduler; documented in a code comment. Does not invalidate VC-13 (respawn still restores the same URL without operator action). No contract strike.
- **RUN-LEVEL (process, not code):** `isolation: "worktree"` produced no isolated worktree — all five Wave-1 agents ran in the single checkout on `feat/tunnel-qr-pairing`, racing on the shared tree and `.git/index`. Caught after briefs 06/08/01 had already committed (cleanly, disjoint files, careful per-file staging — no corruption); 02/04 were stopped before writing. Pivoted to strictly-sequential synchronous executors for the rest of the run. Root cause likely: the checkout is itself a linked git worktree of `../agent-relay`, so nested `.claude/worktrees/` creation off it did not engage. No feature-code impact; VC coverage unchanged.
