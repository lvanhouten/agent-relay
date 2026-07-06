---
status: accepted
date: 2026-07-06
deciders: Lukas Van Houten (owner), Claude (advisor)
---

# 0001 — Persisted access token + stateless HMAC auth cookie

## Context

Pairing a phone to the relay (tunnel + QR) only works if authentication
survives restarts and page reloads. Today neither holds: an unpinned token
regenerates per server run (rotation is *silent* in an open client — polls 401
into an "offline"-looking state, the WS closes 1008 permanently), and the
client keeps the token in React state only, so every page load starts at the
login screen. A paired phone would read as a broken app after every restart.

Comparable tools split two ways: HttpOnly signed cookies (Jupyter, code-server)
vs. tokens in localStorage (Home Assistant, WhatsApp-Web-class pairing).

## Decision

1. **The generated access token persists across runs.** `AR_TOKEN` unset →
   generate once and store in an owner-only file under
   `%LOCALAPPDATA%\agent-relay\` (the board secret-file pattern); later runs
   reuse it. Applies always, tunnel or not — one token model, no behavioral
   fork. `AR_TOKEN` still overrides; deleting the file rotates.
2. **Browsers authenticate with a stateless, HMAC-signed HttpOnly cookie**
   (SameSite=Strict, long Max-Age), issued on a successful token login. No
   server-side session store: verification recomputes the HMAC against a
   signing secret persisted beside the token, so cookies survive restarts and
   rotating the token/secret revokes every issued cookie at once. Bearer-token
   auth remains for non-browser clients. Deliberately **not** called a
   "session" layer — *session* means a PTY line in this codebase (see
   CONTEXT.md).

## Consequences

- A paired device stays paired across server restarts, page reloads, and tab
  eviction; the QR fragment token becomes a one-time bootstrap (Jupyter's
  model), never stored client-side.
- The browser never holds the token in JS-readable storage; XSS can drive the
  API while the page is compromised but cannot exfiltrate the credential.
- A credential now lives at rest on disk (mitigated: owner-only file, same
  boundary as the board pipe secret) — a deliberate trade against per-run
  hygiene.
- CSRF on the cookie path is covered by the existing origin gate (REST CORS +
  WS upgrade) plus SameSite=Strict; the JSON-only POST rule stays load-bearing.
- Auth middleware and the WS gate accept two credential shapes (bearer or
  cookie); the WS `?token=` query param remains for non-browser clients only.
- Known upgrade path if the tool ever goes multi-user / internet-exposed:
  per-device cookies with individual revocation (a real session store).
