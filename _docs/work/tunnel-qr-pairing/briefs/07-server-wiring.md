## Agent Brief

**Category:** enhancement
**Summary:** Wire the feature into server startup: credentials-backed auth, tunnel start with degrade warnings, origin registration, terminal QR print, pairing router mount

**Current behavior:**
The server entry point wires CORS, JSON parsing, the authed API router, optional static client serving, the error handler, and the WS hub; at listen time it prints the URL, the static-build status, and (when generated) the per-run token with usage hints. Nothing about tunnels, cookies, pairing, or QR codes.

**Desired behavior:**
The entry point composes the new modules into the startup sequence (wiring only — no new logic that belongs in the modules):

- Auth now sources token + signing secret from the credentials store (largely transparent if the auth module's exports were kept stable by the middleware/credentials briefs).
- Mount the pairing router under the API path alongside the existing session routes, injecting the tunnel status getter and cookie collaborators.
- When `AR_TUNNEL` is set: create and start the tunnel supervisor. On URL discovery: register the tunnel origin with the origin policy, then print a startup block with the tunnel URL, a plain posture line ("reachable from your tailnet at …"), and a terminal QR (`qrcode-terminal`, new server workspace dependency) encoding the pairing URL (token in the fragment). On any degrade event: print a single console block naming the failed precondition and its fix (install/login hint, unset `AR_NO_AUTH`, run the client build — plus the one-time tailnet setup note: MagicDNS + HTTPS certs must be enabled for `tailscale serve`). Degrades never prevent the local listener from coming up.
- Supervisor respawn/death events log through the same seam (visible, not spammy).
- Graceful shutdown (the existing SIGINT/SIGTERM path) also stops the tunnel supervisor before closing the listener.
- The token banner still prints when the token was *freshly generated*, now noting it persists across runs; a reused persisted token doesn't reprint the full banner by default (the QR/pairing path is the discovery mechanism), but the startup line should say auth is on.

**Key interfaces:**

- Consumes, without modifying: `loadCredentials`-backed auth exports; `createTunnel(...).start()/stop()/status()` and its `{ state, url, reason }` shape; `allowRuntimeOrigin(origin)`; the pairing router factory; `issue`/`setCookieHeader` only via the pairing router's injection.
- `qrcode-terminal` — server dependency, used only here.

**Acceptance criteria:**

- [ ] `AR_TUNNEL` unset → startup output and behavior byte-compatible with today apart from the credentials-store token changes.
- [ ] `AR_TUNNEL=tailscale` with a failing precondition (verifiable without tailscale installed) → server still serves localhost; console shows the single degrade block with the reason and fix.
- [ ] With a stubbed/available tunnel (or by temporarily injecting a fake exec seam in a manual run): URL + posture line + scannable QR printed; `GET /api/pairing` returns the same URL; the tunnel origin passes the origin gate.
- [ ] Ctrl+C stops the tunnel child along with the server.
- [ ] `POST /api/login` and `GET /api/pairing` are reachable on the running server (smoke: curl with the bearer token).
- [ ] Existing server test suites all pass; no new unit tests required for the wiring itself (composition only, per PRD testing decisions).

**Out of scope:**

- Any module-internal behavior (owned by briefs 01–06).
- Client changes.
- README/docs beyond the startup messaging described above.

**Depends on:** 01-credentials-store, 02-auth-cookie (via pairing router injection), 03-dual-auth-middleware, 04-tunnel-supervisor, 05-pairing-endpoints, 06-origin-runtime-allowlist

**Covers:** VC-1, VC-2, VC-8, VC-11, VC-12, VC-16

**Runtime:** exclusive
