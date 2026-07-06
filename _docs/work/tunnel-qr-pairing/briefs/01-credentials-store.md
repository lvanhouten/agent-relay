## Agent Brief

**Category:** enhancement
**Summary:** Persist the generated access token and a cookie-signing secret in an owner-only credentials file, so credentials are stable across server runs

**Current behavior:**
The server's auth module resolves the access token per run: `AR_TOKEN` pins it, `AR_NO_AUTH=1` disables auth (null token), and otherwise `resolveToken` generates a fresh random token each start. A restart therefore silently invalidates every logged-in client (ADR 0001 records why that reads as a broken app). There is no cookie-signing secret anywhere.

**Desired behavior:**
A new server module owns credential resolution with persistence. On load it resolves `{ token, generated, signingSecret }`:

- `AR_NO_AUTH === '1'` → `token: null` (auth disabled). A signing secret is still resolved (generated/persisted) so downstream modules never handle a null secret.
- `AR_TOKEN` set → that token, `generated: false`.
- Otherwise → reuse the token from the credentials file if present; generate (24 random bytes, base64url — same entropy as today) and persist it if not. `generated` is true only when a fresh token was minted this load.
- The signing secret is always generated-once-and-reused from the same file, independent of how the token resolved.

The credentials file lives in the per-user app-data directory the board already uses for its pipe secret (`%LOCALAPPDATA%\agent-relay\` resolution, owner-only file mode — follow the board library's secret-file pattern, including `mode: 0o600` on write). One JSON file holding both values. Deleting the file rotates everything on next start. The directory is created if absent. A corrupt/unreadable file is treated as absent (regenerate), not a crash.

The existing auth module consumes this module instead of its own `resolveToken` (which this supersedes). Its exported `TOKEN` / `TOKEN_GENERATED` semantics must keep working for the startup banner in the server entry point.

**Key interfaces:**

- New module exporting `loadCredentials(env, file?) → { token: string|null, generated: boolean, signingSecret: string }` — `env` injectable (the three shapes above unit-testable without subprocess env games, same design as today's `resolveToken`), `file` injectable for temp-dir tests.
- The auth module's `TOKEN` and `TOKEN_GENERATED` exports now derive from `loadCredentials(process.env)`; `checkToken`/`safeEqual` unchanged.
- A new export surfacing the signing secret to the cookie layer (e.g. `SIGNING_SECRET` alongside `TOKEN`).

**Acceptance criteria:**

- [ ] With `AR_TOKEN` set: returned token is the pinned value; nothing about the token is written, but a signing secret is still persisted and reused.
- [ ] With `AR_NO_AUTH=1`: token is null; signing secret still resolved.
- [ ] With neither: first load generates and persists; a second `loadCredentials` against the same file returns the identical token and secret with `generated: false`.
- [ ] Deleting the file between loads yields a different token/secret pair (rotation).
- [ ] A corrupt file (junk bytes) regenerates instead of throwing.
- [ ] The file is written with owner-only mode (0o600) into a directory created on demand.
- [ ] Existing auth tests still pass; new tests use a temp dir, never the real app-data path.

**Out of scope:**

- Cookie mint/verify (sibling brief introduces the cookie module).
- Any middleware or wiring changes beyond making the auth module source its token from this store.
- Windows ACL verification of the secret file (existing deferred issue).

**Depends on:** none

**Covers:** VC-6, VC-17, VC-18

**Runtime:** parallel-safe
