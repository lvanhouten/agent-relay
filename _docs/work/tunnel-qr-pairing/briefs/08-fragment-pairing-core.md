## Agent Brief

**Category:** enhancement
**Summary:** Pure client-core module for reading the pairing token from a URL fragment

**Current behavior:**
The client core (TypeScript, under the client's `core/` seam) has no notion of URL fragments; the login screen only accepts a hand-typed token.

**Desired behavior:**
A new pure module in the client core (TypeScript, explicit `.ts` import extensions, unit-tested under `node --test` via type stripping like the rest of the core) that owns fragment-token semantics:

- Parse a location-hash string and extract the pairing token when the fragment has the pairing shape (`#token=<value>`). Return null for anything else — empty hash, other fragments, empty token value, junk.
- Percent-decoding handled (the token is base64url so it's usually inert, but a decoded read must not throw on malformed escapes — return null instead).
- The module documents (and its callers implement) the strip rule: the fragment must be removed from the address bar immediately after reading, before any network call, via a history-replace — the module itself stays pure (no window access) so it's testable; it can export a helper that computes the stripped URL from an href.

**Key interfaces:**

- `readFragmentToken(hash: string) → string | null`.
- Optionally `stripFragment(href: string) → string` — the same href minus the pairing fragment, for the caller's history-replace.
- Types live alongside the core's existing contracts; no screen (JSX) changes in this brief.

**Acceptance criteria:**

- [ ] `#token=abc123` → `abc123`; leading `#` optional in the input contract (pick one and test it).
- [ ] Empty string, `#`, `#other=x`, `#token=` (empty value) → null.
- [ ] Percent-encoded token round-trips; malformed percent-escapes → null, no throw.
- [ ] `stripFragment` (if provided) removes only the fragment, preserving path and query.
- [ ] Unit tests in the client core's existing `.test.ts` style; `npm run typecheck --workspace=client` stays green.

**Out of scope:**

- Wiring into the login/boot flow (client-boot-flow brief).
- Any server-side handling of fragments (none exists by design — fragments never reach the server).

**Depends on:** none

**Covers:** VC-4 (the strip substrate; the boot flow completes it)

**Runtime:** parallel-safe
