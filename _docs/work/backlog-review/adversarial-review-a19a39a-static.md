# Adversarial Review: static serving (slice 1 of 5 + seams)

**Scope:** `server/src/static.js` (new), `server/src/static.test.js`, `server/index.js` wiring, root `package.json` build script — "Serve the built client from Express (same-origin production story)".
**Reviewed:** `0c0edf4..82d28f2` (slice of the `3bd5d96..a19a39a` backlog review; working tree clean)
**Verdict:** CONCERNS (2 warnings, both confidence ≥ 50)

Panel: Saboteur / Maintainer / Security Auditor (single isolated pass). The reviewer verified `express.static` fallthrough semantics and `send`'s traversal regex against the vendored sources before asserting anything — Windows-backslash path traversal was explicitly checked and ruled out (`send`'s `UP_PATH_REGEXP` matches both separators).

### Warnings

**W1. SPA fallback masks missing hashed assets as 200 HTML** — `server/src/static.js:37-48` · confidence 70 · Saboteur
`express.static` mounts with default `fallthrough: true`, and the next middleware is the SPA fallback, which excludes only `/api` and `/sessions` — it does not distinguish a navigation path from an asset path that doesn't exist. Triggering scenario: a tab open across a redeploy requests `GET /assets/app.<oldhash>.js`; the file is gone from the new dist, static falls through, and the fallback serves `index.html` as 200 `text/html`. The browser executes HTML as JS and throws an opaque syntax error — much harder to diagnose than a clean 404. `static.test.js` has no test for a well-formed-but-nonexistent `/assets/` path (the specific untested failure mode).
**Fix:** in the fallback, `next()` (→404) when the path starts with `/assets/` or its last segment has a file extension; reserve the HTML fallback for extension-less navigational paths.
**Resolution (fixed):** exactly that — the fallback now `next()`s for `/assets/*` and any path whose last segment carries a file extension (`/\.[^/]+$/`), reserving index.html for extension-less navigational paths. Three new tests (missing hashed asset → 404, extensioned unknown → 404, dot-in-middle-segment still navigational), mutation-proven (guard removed → both 404 tests fail).

**W2. Reserved-path list is a hardcoded cross-file invariant** — `server/src/static.js:42-43` (mount: `server/index.js:58-59`) · confidence 60 · Maintainer
The fallback is an unconditional catch-all for unmatched GET/HEAD except two hand-written prefixes. Any future top-level route mounted after the static router (or omitted from this two-item list) is silently swallowed — the fallback serves HTML and never calls `next()`. Nothing at the mount site in `index.js` signals the constraint; a maintainer adding e.g. a `/healthz` route must already know to open `static.js`.
**Fix:** derive the exclusions from a shared reserved-prefix list exported once, or at minimum add a comment at the static mount site in `index.js` pointing route additions at this constraint.
**Resolution (fixed):** both halves — the exclusions now live in an exported `RESERVED_PREFIXES` list + `isReservedPath()` in static.js, and the mount-site comment in index.js explicitly tells a route-adder to extend that list. Also closes N1 in the same function: the check is now case-insensitive to match Express's own mount matching, with a test pinning `/API/unknown` → 404.

### Notes

**N1. `/API/…` bypasses the fallback's case-sensitive exclusion** — `server/src/static.js:42-43` · confidence 50 · Security
Express route matching is case-insensitive by default (repo never enables `case sensitive routing`), but `req.path.startsWith('/api/')` is case-sensitive. An **authenticated** `GET /API/bogus` passes both `/api` mounts unmatched, reaches the fallback, and gets `index.html` (200 HTML) instead of the documented "API 404s stay API 404s". (Unauthenticated requests still 401 at `authMiddleware`, so no data exposure — invariant violation only.)
**Fix:** `req.path.toLowerCase().startsWith('/api/')` (and `/sessions`).

**N2. dist disappearing mid-run degrades to a generic JSON 500 per page load** — `server/src/static.js:14-19,44-48` · confidence 40 · Saboteur
The existence check runs once at startup and only reasons about a build *appearing*. If `client/dist` is removed/swapped non-atomically while the server runs, every page load hits `res.sendFile` → ENOENT → `errorHandler` → `{error}` 500. Acceptable if deploys always restart the server (matches the `--watch` story) — worth a one-line comment scoping it out, or a plainer ENOENT response.
**Resolution (fixed, comment):** the startup-check comment now scopes the reverse case out explicitly — mid-run dist removal degrades to the generic 500 by design, because deploys restart the server.

### Summary

The core design (unauthenticated static by intent, immutable hashed assets, no-cache index, API-wins mount order) is sound and matches the documented decisions. The real risk is W1 — the post-redeploy stale-tab failure mode produces a confusing runtime error with no 404 anywhere, and it's exactly the scenario the immutable/no-cache split invites. W2 is the maintenance trap most likely to bite next quarter.

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| W1 | WARNING | 70 | SPA fallback masks missing hashed assets as 200 HTML | fixed |
| W2 | WARNING | 60 | Reserved-path list is a hardcoded cross-file invariant | fixed |
| N1 | NOTE | 50 | `/API/…` case-mismatch serves HTML to authenticated callers | fixed (with W2) |
| N2 | NOTE | 40 | Vanishing dist mid-run → generic 500 | fixed (comment) |
