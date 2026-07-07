# Adversarial Review: Pushover notify + needs-input + hook→line-id bridge (slice 3 of 5 + seams)

**Scope:** `server/src/notifiers.js` (new), `POST /api/notify` (`server/src/api.js`), `server/src/sessions.js` attention lifecycle, `server/src/ws.js` clear-on-input, `server/board/board.js` `AGENT_RELAY_SESSION` env injection, `server/index.js` wiring, README hook recipe, StatusDot/SessionsScreen rendering, tests.
**Reviewed:** `d5ca147..44c26d3` (slice of the `3bd5d96..a19a39a` backlog review; working tree clean)
**Verdict:** CONCERNS (5 warnings, four at confidence ≥ 55)

Mode: fan-out — Saboteur, Maintainer, and Security Auditor ran as isolated agents, blind to each other. Orchestrator ground-checked the top claims directly (grep confirmed zero `console.*` calls in the notify path; the duplicated validation loops verified at `api.js:13-19` vs `:31-37`).

### Warnings

**W1. Notifier failures are never logged — the stated "log, never crash" contract ships only its second half** — `server/src/notifiers.js` (`notifyAll`), `server/src/api.js` (`POST /notify` handler) · confidence 75 · Saboteur
`Promise.allSettled` delivers "never crash," but there is not a single `console.error`/`warn`/`log` in the entire notify path (grep-verified). Per-sink failures surface only in the HTTP response body — which the documented fire-and-forget hook (`curl -s … &`) never reads. Scenario: `AR_PUSHOVER_TOKEN` revoked or Pushover 429s → every notification silently fails forever, no trace in any log, discovered only when a needed phone alert doesn't arrive — precisely when the operator can't see the terminal to notice another way. The intent doc explicitly required "log, don't crash." No test spies on logging (both suites assert only the HTTP-visible outcome).
**Fix:** `console.error` each rejected/`ok:false` sink outcome in `notifyAll` (mirror `sessions.js`'s `[sessions] board … RPC failed` pattern).
**Resolution (fixed):** `notifyAll` now logs `[notify] sink <name> failed: <error>` per rejected sink (injectable `log`, default `console.error`), so every caller path gets the logging. Two new tests pin it (failure logs / success doesn't), mutation-proven (log call deleted → test fails).

**W2. Copy-pasted field-cap validation loop between `validateSpawnBody` and `validateNotifyBody`** — `server/src/api.js:13-19, 31-37` · confidence 80 · Maintainer
Byte-for-byte the same type/length loop over a different cap table, in the same file. A future fix to one (trim-before-check, non-finite rejection) has no structural reason to land in the other; a third validated body (`/api/templates` phase 2 is already on the backlog) makes it three drifting copies.
**Fix:** extract `validateFieldCaps(body, caps)`; layer each endpoint's extra rules (title-or-body, priority range, needsInput boolean) on top.

**W3. `sessions.clearAttention?.(id)` optional-chains around an incomplete test double, not a real nullability** — `server/src/ws.js:85` · confidence 70 · Maintainer
Production `sessions` is always a `BoardSessions` (which always has `clearAttention`); the `?.` exists only because `ws.test.js`'s `makeSessions()` fixture omits the method. Cost: if `clearAttention` is ever renamed or a future sessions implementation forgets it, this line silently no-ops and the needs-input flag never clears on WS input — a regression with no error to grep for.
**Fix:** add a no-op `clearAttention` to the fixture and drop the `?.` (or comment the permissiveness as intentional).

**W4. Hook recipe puts the bearer token in curl argv** — `README.md` (hook recipe) · confidence 55 · Security
`-H "Authorization: Bearer $AR_TOKEN"` expands the token into the process command line, visible to any local principal with process-listing rights (Task Manager's command-line column, `Get-CimInstance Win32_Process`, EDR telemetry — relevant on a SOC2/HIPAA-context workstation). A different exposure channel than the env var itself: argv is routinely sampled by monitoring tooling. New surface introduced by this diff.
**Fix:** feed the header via `curl --config -` on stdin or a tightened-ACL `-K` file; at minimum add the caveat beside the recipe.

**W5. `/api/notify`'s `url` field is forwarded to Pushover unvalidated — an off-device phishing vector that exceeds the accepted XSS ceiling** — `server/src/api.js` (`NOTIFY_MAX.url` caps length only), `server/src/notifiers.js` (url passthrough) · confidence 55 · Security
ADR-0001 accepts "XSS can drive the API" because the blast radius was local shell spawn — something the token-holder could already do. But `url` renders as a tap-through deep link inside a *trusted* push notification on the operator's phone, potentially days later, away from the compromised browser context. An XSS-driven caller can deliver a convincing "Claude needs input" notification whose tap lands on a credential-harvesting page — a capability `POST /sessions` cannot reach, targeting the human rather than the machine.
**Fix:** require `https://` and restrict `url` to the relay's own origin (deep-link back into the relay), or drop the passthrough until scoped tokens land.
**Resolution (fixed):** default-deny with explicit opt-in — `url` is now rejected (400) unless `AR_NOTIFY_URL_ORIGIN` names the one allowed origin (the server can't know its own tunnel hostname, so the operator states it). Comparison is by parsed `URL.origin`, never a string prefix, so `https://relay.example.evil.com` can't ride `https://relay.example`; scheme is part of the origin, so an http downgrade is also rejected. Tests cover no-config deny, allowed-origin pass-through, lookalike host, downgrade, and relative URL; mutation-proven. README updated (API table + Notifications section).

### Notes

**N1. `_attention` Map prunes only inside `list()` — grows while nobody polls, and a board-restart id reuse can inherit a stale flag** — `server/src/sessions.js:113-115, 180-183` · confidence 55 · Saboteur (demoted from WARNING: blast radius is a Map of id→timestamp — memory impact is negligible at any realistic session count, and the output-after-flag overlay self-heals most misapplications)
The scenario is real (push exists precisely for when nobody is watching the dashboard, i.e. when `list()` isn't running), but the entries are ~tens of bytes and the first `list()` prunes. The sharper residual edge: line ids restart per board boot, so a web tier that outlives a board restart can hold a flag that a *reused* id inherits — usually cleared immediately by the new line's output, but briefly mislabeling a fresh session as needs-input.
**Fix (optional):** reconcile `_attention` on a low-frequency interval independent of HTTP traffic, or namespace flags by the board's boot nonce the way `mcp-server.js` namespaces read cursors.

**N2. No dedup/throttle on `POST /notify`; compounds with Pushover priority-2 auto-retry** — `server/src/api.js`, `server/src/notifiers.js` (priority 2 → `retry: 60, expire: 3600`) · confidence 45 · Saboteur (demoted per the <50 rule)
Duplicate hook registrations or a retrying hook script firing several `needsInput, priority:2` calls each become independent Pushover messages, each re-alerting every 60s for an hour — a stacking buzz-storm with no collapse path. Untested.
**Fix:** debounce per resolved session id within a short window, or skip re-notify for an already-flagged live session.

**N3. Payload discipline ("no session output to Pushover") is prose-only** — `server/src/notifiers.js:16-18`, `server/src/api.js:25` · confidence 50 · Security
`title`/`body` pass straight through with only length caps (200/1000). The shipped recipe sends static strings, so nothing is exploitable today — but the code's own comment names the PHI/secret risk, and nothing technical prevents a future hook stuffing terminal output into `body`. Deliberate-acceptance note or a much shorter body cap would make the discipline structural.

**N4. New attention tests assert on the private `_attention` Map** — `server/src/sessions.test.js` (flagAttentionByCwd tests) · confidence 65 · Maintainer
Every pre-existing test in the file observes only the public surface (return values, issued RPCs); the new tests reach into `s._attention` directly, coupling them to the representation. Refactoring the store breaks tests that have nothing to do with behavior.
**Fix:** assert through `list()`'s status overlay; keep direct field access only where no public observation exists.

**N5. The needs-input clear rides an unstated timing assumption between hook POST and prompt output** — `server/src/sessions.js:157-166` · confidence 40 · Maintainer + orchestrator seam pass (converging independently, but both low-confidence — held at NOTE)
`_applyAttention` drops the flag when `idleMs` implies output after flag-time. This works because a Notification hook fires *after* the prompt's final paint and polls are coarser than the hook's round-trip — but nothing documents or guards that ordering. A laggy hook POST racing a TUI repaint (or an attach-triggered resize repaint) silently clears a flag that should stick. Soft failure (stale UI, no corruption), zero test coverage of the ordering.
**Fix:** document the ordering assumption at `_applyAttention`, and consider a small grace window (e.g. ignore output within ~1s after flag) if false-clears show up in practice.

### Summary

The seam design (pluggable notifiers, dumb endpoint, web-tier flag) is faithful to the intent docs, and the auth/CSRF posture of the new endpoint is correct (behind `authMiddleware`, JSON-only rule kept). The gap is operational visibility and egress hygiene: W1 makes the feature's failure mode invisible exactly when it matters, and W5 is the one finding that genuinely escapes the ADR's accepted-risk envelope — both are small fixes. W1 and W5 first.

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| W2 | WARNING | 80 | Copy-pasted validation loop (spawn vs notify) | (open) |
| W1 | WARNING | 75 | Notifier failures never logged — silent-forever failure | fixed |
| W3 | WARNING | 70 | `clearAttention?.()` masks a contract, tolerates stale fixture | (open) |
| W4 | WARNING | 55 | Bearer token in curl argv (README recipe) | (open) |
| W5 | WARNING | 55 | Unvalidated `url` → trusted-channel phishing beyond XSS ceiling | fixed |
| N4 | NOTE | 65 | Tests assert private `_attention` representation | (open) |
| N1 | NOTE | 55 | `_attention` prune only in `list()`; id-reuse edge | (open) |
| N3 | NOTE | 50 | Payload discipline is prose-only | (open) |
| N2 | NOTE | 45 | No notify dedup; priority-2 stacking | (open) |
| N5 | NOTE | 40 | Undocumented hook-vs-output timing assumption in clear logic | (open) |
