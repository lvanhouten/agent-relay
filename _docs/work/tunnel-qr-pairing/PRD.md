# PRD — Built-in Tunnel + QR Pairing

## Problem Statement

The relay's same-origin model says you reach it by loading the page from it — but there is no built-in path from another device to this server. Getting a phone connected today means installing and configuring a tunnel by hand, finding its URL, then typing a long random token on a soft keyboard. Worse, the pairing doesn't stick: an unpinned access token regenerates on every server restart and the client keeps its token in memory only, so a "paired" phone silently degrades into a frozen-looking app (polls 401 into an offline-looking state, the terminal socket closes permanently) after any restart or tab eviction. Every mobile-facing idea in the backlog (push notifications, PWA install) sits behind this gap.

## Solution

Set one environment variable and the relay comes up reachable on the operator's tailnet: it spawns and supervises the tunnel itself, prints the stable tailnet URL and a QR code in the console, and offers the same QR from a "pair a device" affordance in the already-paired web UI (for headless autostart runs). Scanning the QR opens the page and logs the device in automatically — no token typing. Pairing then *sticks*: the generated access token persists across server runs, and the browser holds a long-lived, HttpOnly auth cookie that survives restarts, reloads, and tab eviction. If the tunnel can't come up, the relay warns loudly and keeps working local-only — a tunnel problem never takes down desk work.

## User Stories

1. As an operator, I want the relay to expose itself over my tailnet when I set a single environment variable, so that my phone can reach it without hand-run tunnel setup.
2. As an operator, I want the startup console to print the tunnel URL and a pairing QR code, so that pairing a phone is scan-and-go.
3. As an operator on my phone, I want scanning the pairing QR to log me in automatically with no token typing and no extra tap, so that pairing is the whole login flow.
4. As an operator on my phone, I want the token removed from the address bar immediately after pairing, so that the credential doesn't linger in my browser history or shared-screen view.
5. As an operator, I want a stale pairing QR (token rotated since it was minted) to land me on the manual login form with a clear error, so that a failed pairing is explainable rather than a dead page.
6. As an operator, I want my paired devices to stay paired across server restarts, so that a restart doesn't turn the app into a frozen-looking screen on every phone.
7. As an operator, I want my browser login to survive page reloads and tab eviction, so that I authenticate once per device, not once per visit.
8. As an operator, I want the sessions screen and terminal to work end-to-end through the tunnel, so that a paired phone is a full client, not a read-only view.
9. As an operator, I want a "pair a device" affordance in the web UI that shows the pairing QR, so that I can pair a new device even when the relay runs headless (autostart, no console).
10. As an operator, I want the relay to warn loudly and continue local-only when a tunnel precondition fails (tailscale missing or logged out, auth disabled, no client build), so that a tunnel problem never takes down desk work.
11. As an operator, I want the tunnel supervised — respawned with backoff if it dies mid-run — so that a transient hiccup self-heals without me at the desk and without re-pairing.
12. As an operator, I want no tunnel to ever start while auth is disabled, so that an unauthenticated relay is never network-exposed.
13. As an operator using non-browser clients (curl, scripts), I want the bearer token to keep working exactly as before, so that automation is unaffected by the cookie layer.
14. As an operator, I want manual token login over cleartext (http from a non-localhost host) to still require the explicit second-click acknowledgement, so that the pairing work doesn't weaken the existing credential-safety gate.
15. As an operator, I want the login page itself to load without authentication through the tunnel, so that a new device can reach the pairing flow at all.

## Implementation Decisions

Decisions below are grounded in the grilling session (2026-07-06), ADR 0001, and CONTEXT.md's glossary — *session* means a PTY line throughout; the browser-auth artifact is the *auth cookie*.

**Credentials store (new server module).** One load-or-create entry point resolving `{ token, generated, signingSecret }` from the environment plus an owner-only credentials file in the per-user app-data directory (same pattern and boundary as the board's pipe-secret file). `AR_TOKEN` pins the token; `AR_NO_AUTH=1` yields a null token; otherwise the token is generated on first run and reused thereafter. The cookie-signing secret is always generated-and-persisted. Deleting the file rotates everything; rotation invalidates every issued auth cookie at once. Supersedes the per-run `resolveToken` behavior — persistence applies always, tunnel or not, so there is exactly one token model.

**Auth cookie (new server module).** Stateless, HMAC-SHA256-signed value carrying a version tag, a random device id, and issued-at; verified by recomputing the signature against the persisted signing secret — no server-side store. The device id is a forward-compatibility hook for the parked paired-device dashboard (see the 2026-07-06 issue doc): it must be minted from day one or a future device registry forces every device to re-pair. Cookie attributes: HttpOnly, SameSite=Strict, Path=/, Max-Age ~90 days, Secure when the login request arrived over https. Expiry is enforced server-side from the signed issued-at, not just by cookie lifetime. Cookies are host-only: each origin the relay is reached through (localhost, the tunnel URL) pairs independently, so a browser using both holds two independent auth cookies — this is intended, not a bug. A manual login acknowledged through the cleartext second-click gate still mints the standard cookie (without Secure): the acknowledgement is the operator accepting cleartext exposure, and it covers the cookie the exchange produces.

**Auth middleware (modified).** Accepts either a valid bearer token (unchanged) or a valid auth cookie. Cookie parsing is a hand-rolled single-header parse — no new dependency. The WS upgrade gate gains the same either/or: browsers ride the cookie (their upgrade carries it automatically); the `?token=` query param remains for non-browser clients.

**Pairing router (new server module).** Two endpoints under the API: a login endpoint that exchanges a valid bearer token for a Set-Cookie — it demands the bearer credential specifically (an ambient cookie does not satisfy it) and is the only place cookies are minted — and a cookie-or-bearer-authed pairing endpoint returning the pairing URL plus current tunnel status (up, or down-with-reason); when the tunnel is down the response carries status only — no pairing URL, since a localhost URL is unreachable from the device being paired. The pairing URL embeds the access token in the URL *fragment* (never query — fragments don't reach server logs or Referer headers). Known accepted property: any cookie-authed caller can recover the token via the pairing endpoint — coherent for a single-operator tool; per-device scoping is the parked scoped-tokens work.

**Tunnel supervisor (new server module).** Created with the port and injectable process/filesystem seams. Precondition checks run first and each failure degrades (never exits): tailscale binary present and logged in, client build present (a tunnel to a page-less server is useless), and auth enabled — `AR_NO_AUTH=1` unconditionally refuses to start a tunnel, satisfying the issue's hard security requirement via degrade. On start: configure/spawn `tailscale serve` for the relay port in foreground mode (config reverts when the child dies), discover the stable tailnet URL from the tailscale CLI's status output rather than scraping serve's stdout, report the URL to the wiring layer. On child death: respawn with capped exponential backoff, logging each attempt; the tailnet URL is stable so a respawn restores the same pairing — no re-scan. Status is queryable for the pairing endpoint.

**Origin policy (modified).** The allowlist gains a runtime-injectable origin: at startup the wiring layer adds the discovered tunnel origin, so the gate holds regardless of how the tailscale proxy rewrites the Host header. The existing pure-function shape stays (allowlist remains an injectable parameter).

**Server wiring (modified).** Startup sequence: load credentials → mount auth + pairing → start tunnel (when `AR_TUNNEL=tailscale`) → on URL discovery, add the tunnel origin to the allowlist and print the URL plus a terminal QR (`qrcode-terminal`, new server dependency) encoding the pairing URL. Degrade warnings appear as a single console block naming the failed precondition and its fix (install/login hint, unset `AR_NO_AUTH`, run the build). The value scheme is `AR_TUNNEL=tailscale` (value-based, matching the `AR_*` env family; future providers add values, not flags).

**Client boot flow (modified screens + new core module).** A pure fragment-reader extracts a token from the URL fragment and the boot path strips it immediately (history-replace) before any probe. Boot order: fragment token present → auto-login (exchange for cookie, land on sessions screen; on failure fall back to the manual form with a clear error) → otherwise probe with the ambient cookie (skip login on success) → otherwise the manual login form, which now performs the cookie exchange on success and keeps its existing cleartext second-click gate. The client core's fetch wrappers gain the login and pairing calls; the token parameter on the rest becomes optional since the cookie is ambient. The WS hook omits the token query string when no token is supplied — the cookie rides the upgrade.

**Pair-a-device dialog (modified sessions screen).** An affordance that fetches the pairing endpoint and renders the pairing URL as a QR client-side (`qrcode`, new client dependency), showing tunnel status inline — a degraded tunnel is visible from the UI, not just the console.

## Testing Decisions

Good tests here assert external behavior only: what a request/response pair does, what a cookie round-trip yields, what the supervisor decides — never module internals. Prior art: the server's existing `node --test` unit suites for auth, origin, api, static (supertest-style request assertions against an Express app with injected collaborators), and the client core's `.test.ts` files run via Node type stripping.

All listed areas are **parallel-safe** (temp dirs, injected seams, ephemeral ports; no live tailscale, no board, no shared state):

- **Credentials store** — all three env shapes; first-run generate-and-persist vs reuse-on-second-load; owner-only file semantics via a temp dir.
- **Auth cookie** — issue/verify round-trip, tampered signature rejected, expired issued-at rejected, malformed value rejected, device id survives the round-trip.
- **Auth middleware** — bearer-only, cookie-only, both-invalid, cookie-plus-`AR_NO_AUTH`; extends the existing auth suite.
- **Pairing router** — login exchanges valid bearer for Set-Cookie with the decided attributes; invalid bearer gets no cookie; pairing endpoint requires auth, embeds the token in a fragment, reports tunnel status.
- **Tunnel supervisor (pure parts only)** — precondition evaluation per failure mode (each yields the right degrade reason), URL discovery parsing from canned CLI JSON, backoff sequence progression and cap, no-live-tailscale by construction (injected exec).
- **Origin policy** — runtime-added tunnel origin passes; the pin test: a request with the tailnet Origin passes the gate regardless of Host-header value.
- **Client core: fragment reader** — extracts, rejects junk, strip semantics.

Not unit-tested, per repo convention: server wiring (composition only), thin client fetch wrappers, and JSX screens (no DOM harness — behavior changes land as named guarded code paths, proven by mutation where a guard is load-bearing). The WS cookie path's logic lives in the tested auth modules; the ws.js wiring delta stays thin.

## Out of Scope

- **Cloudflared (or any second tunnel provider).** V1 is tailscale-only; the supervisor's shape leaves room for more values of `AR_TUNNEL`, but no cloudflared code ships.
- **Paired/connected device dashboard and per-device unpair.** Parked deliberately (2026-07-06 issue doc); v1 ships only the device-id hook inside the cookie payload. Revocation remains all-or-nothing token rotation.
- **Scoped tokens.** The pairing endpoint intentionally lets any cookie-authed caller mint the QR (recover the token); narrowing that is the existing scoped-tokens backlog item.
- **Web Push / PWA manifest work.** This feature is their prerequisite, not their delivery.
- **Rate-limiting the login probe.** Dropped with the public-internet posture — tailnet reachability plus the existing constant-time compare suffices for v1.
- **A CLI pairing command.** Headless pairing is served by the web UI affordance.

## Further Notes

- Tailnet HTTPS requires MagicDNS and HTTPS certificates enabled on the tailnet; where they're off, `tailscale serve` fails and the relay degrades with the warning naming the fix. Document this as the one-time tailnet setup step.
- The startup posture line should state the new reachability plainly ("reachable from your tailnet at …") even though it's milder than the public-internet warning the original issue sketched for cloudflared.
- Token rotation UX: after deleting the credentials file, every device (including the desktop) must re-pair; the stale-QR fallback (story 5) is the recovery path.
- The tombstone e2e test pattern (isolated board via env namespace) is the template if an integration test around the tunnel supervisor's spawn path is ever wanted; v1 deliberately keeps supervisor coverage at the pure seams.
