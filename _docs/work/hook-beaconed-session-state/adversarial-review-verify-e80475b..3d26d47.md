## Remediation Verification: hook-beaconed session state — e80475b..3d26d47

**Verifies:** `_docs/work/hook-beaconed-session-state/adversarial-review-ccca4d6..e80475b.md` (annotated by `remediate --batch`, in worktree `remediate/hook-beaconed-session-state/611b4a3`)
**Range:** `e80475b..3d26d47257eca5875ea37b82916e554021291cf6` (the four remediation commits + the doc-annotation commit)
**Verdict:** CLEARED

### Summary

The remediation can merge. All four original findings hold up: W1's drift trap is *structurally* eliminated (not merely commented away), W2/N2 are the reviewer's own explicitly-offered documentation remedies applied faithfully, and N1's verdict-E reject is justified by the code. The new-defect sweep over the fix diff — a pure extraction, three comment blocks, and two closure tests — introduced nothing. Server suite is 286/286 green (was 284), matching the remediation's claim, and the two W1 tests genuinely guard their invariant (re-inlining either overlay's check trips them).

## Priority ranking

No new findings introduced by the remediation. (The close-out verdicts for the original findings are in the table below.)

### Close-out (original findings)

| Orig ID | Claimed | Verify verdict | Evidence |
|---------|---------|----------------|----------|
| W1 | Resolved (A) | ✅ Confirmed closed | `_outputLandedAfter` is the *only* copy of `this._now() - (line.idleMs ?? 0) > ts` (`sessions.js:245`); both overlays route through it — `_applyAttention` clears on it (`:267`), `_applyBeacon` keeps turn-done on `!` it (`:290`) — with byte-identical polarity to the pre-fix inline checks. Grace-window drift is now impossible: the future refinement lands in one method. Two tests (`W1: _applyBeacon…` / `_applyAttention…`, `sessions.test.js:412/427`) stub the primitive and assert each overlay obeys it; re-inlining either check makes the stub unreachable and the `cleared` case fails — mutation-confirmed. |
| W2 | Resolved (A — validate-before-read marker) | ✅ Confirmed closed | The finding is forward-looking (no live sink) and explicitly offered "an explicit 'validate before reading' marker" as an acceptable remedy; the fix applies exactly that at all three boundaries the value crosses (`sessions.js:122` `_beacons` decl, `:216` storage assign, `api.js:53` `BEACON_MAX`). Each states the load-bearing fact — attacker-suppliable, length-capped only, stored inertly, MUST canonicalize + confine before any read — and rebuts the "purely additive" trap. Independently confirmed inert: `transcriptPath` is only *assigned* (`sessions.js:216`) and *accepted from body* (`api.js:184`), never read, never in the DTO. Correctly did **not** validate at storage (validate-at-use; an eager check could reject a legitimate path). |
| N1 | Rejected (E) | ✅ Reject upheld | Re-derived cold: `beacon()` mutates only the per-instance `_beacons` map and returns an id — no spawn, no notifier fan-out, no DTO/data exposure (verified by reading the whole method + `list()` overlay path). The blast radius is cosmetic card state exactly as claimed, so the "dumb set" is deliberate `/api/notify` parity under ADR-0001's single-operator ceiling, not a defect. The reviewer itself concluded "not a defect to fix" (conf 40). A durable `TRUST MODEL` comment (`sessions.js:186–190`) now blocks a future re-flag. The E-reject is justified — **not** wrongly rejected. |
| N2 | Resolved (A — comment reconciled) | ✅ Confirmed closed | The finding's core defect was the code/comment *contradiction*, and it is gone: the header now scopes the "never fall through" invariant to a *non-empty* id and documents empty-string as the intentional "couldn't resolve" sentinel (`sessions.js:191–198`), with an inline note at the falsy guard (`:206`). Code and comment agree. The remediator's rejection of the two alternative fixes is sound — rejecting `''` in validation or set-and-pruning it would kill the `cwd` backstop for a non-board-spawned line and turn the beacon into a silent no-op; verified against the existing VC-12 fallthrough tests (still green). |

### New findings (introduced by the remediation)

None. The fix diff is a behavior-neutral extraction (`_outputLandedAfter`), three additive comment blocks, and two closure tests. The sweep checked: the extracted primitive reads `line.idleMs` at both call sites exactly as the inline versions did (no shape drift); the shared module-level `overlayLine` test fixture is only *read* by the overlays (per-instance `_beacons`/`_attention` carry all mutation), so the two test sessions cannot cross-contaminate; no error path, resource, or trust boundary is newly crossed. Server 286/286 green.
