## Adversarial Review: hook-beaconed session state (SessionStart/Stop/SessionEnd beacons → honest Claude-line status)

**Scope:** feature branch `features/hook-beaconed-session-state` vs `main`. Reviewable code: `server/src/api.js` (POST `/beacon` + validation), `server/src/sessions.js` (`beacon()`, `_resolveLiveIdByCwd()`, `_applyBeacon()`, `clearAttention()`, `list()` overlay), `client/src/core/attention.ts` (`turn-done` view + `attentionRank`), `client/src/core/types.ts`, `client/src/screens/SessionsScreen.jsx` (rank sort). Tests: `server/src/{api,sessions}.test.js`, `client/src/core/attention.test.ts`. ~449 lines churn, 2 subsystems. Core trio (Saboteur / Maintainer / Security), in-context — no DB, hot-path, or PHI surface to summon a specialist.
**Reviewed:** `ccca4d6..e80475b` (working tree clean).
**Verdict:** CONCERNS (2 warnings, both confidence ≥ 50; no criticals)

### Summary

The change is unusually well-built: every one of the 15 validation-contract assertions is delivered and directly tested (server 284/284 green), the `_beacons` map inherits `_attention`'s boot-nonce void + dead-id prune, exited lines correctly bypass the beacon overlay (VC-14), and needs-input correctly outranks turn-done (VC-7). No correctness defect breaks a promised behavior. The findings are forward-looking, not blocking: **W1** (a documented future grace-window fix will silently drift across two copies of the staleness check) is the one to fix before merge; **W2** flags that the `transcriptPath` this change begins storing is attacker-suppliable and captured expressly so a *future* feature trusts it unvalidated.

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| ~~W1~~ | WARNING | 60 | `_applyAttention`/`_applyBeacon` hand-roll the same "output landed after T" check; anticipated grace-window fix will drift | ✅ Resolved `e3a6497` |
| ~~W2~~ | WARNING | 50 | Unvalidated `transcriptPath` from the beacon body is stored now precisely so a future transcript-tailer trusts it — a latent path-traversal / arbitrary-file-read trap | ✅ Resolved `7e97b4b` |
| ~~N1~~ | NOTE | 40 | POST `/beacon` trusts `sessionId` with no ownership check — any authenticated caller can force/clear any live line's card state | ✋ Rejected `c1218ab` |
| ~~N2~~ | NOTE | 45 | An empty-string `sessionId` passes validation, is falsy, and falls through to the `cwd` fallback, contradicting the "present sessionId never falls through" invariant | ✅ Resolved `895b68d` |

**What's left:** Resolved 3 (W1, W2, N2) · Rejected 1 (N1) · Deferred 0 · Open 0. Remediation range `e80475b..895b68d` (on branch `remediate/hook-beaconed-session-state/611b4a3`). N1's "rejection" is a reviewer-conceded NOTE ("not a defect to fix") closed with a durable clarifying comment — see its Resolution.

### Warnings

**W1. Duplicated "output-landed-after-timestamp" staleness check across two overlays** — `server/src/sessions.js:232` and `server/src/sessions.js:254` · confidence 60

**Status:** ✅ Resolved in `e3a6497` — see below.
**Resolution:** Accepted as framed. Extracted a single `_outputLandedAfter(line, ts)` private method (the one `this._now() - (line.idleMs ?? 0) > ts` primitive) and routed both overlays through it: `_applyAttention` clears on `_outputLandedAfter(...)`, `_applyBeacon` keeps turn-done on `!_outputLandedAfter(...)` — identical polarity to before, so behavior is unchanged. The anticipated grace-window fix now lands once, in the helper, and reaches both cards; the drift trap is structurally gone (`this._now() - (line.idleMs ?? 0)` now appears exactly once). Closure check: two new tests (`W1: _applyBeacon…` / `W1: _applyAttention…` in `sessions.test.js`) stub `_outputLandedAfter` and assert each overlay obeys the stub's kept/cleared verdict — proven by mutation (re-inlining `_applyBeacon`'s check turns the beacon test red). Server 286/286 green.

---

`_applyAttention` (needs-input) and `_applyBeacon` (turn-done) each independently compute `lastOutputAt = this._now() - (line.idleMs ?? 0)` and compare it against a stored wall-clock timestamp to decide whether the state is stale. It is the same primitive — "has the line emitted output since instant T?" — hand-rolled twice with opposite comparison polarity (`>` clears the flag; `<=` keeps turn-done).

The drift trap is not hypothetical: the `_applyAttention` comment (`sessions.js:226-228`) explicitly anticipates the next change — *"If false-clears show up in practice, add a small grace window (ignore output within ~1s after flaggedAt)…"* — and `_applyBeacon`'s comment (`sessions.js:246-248`) states it *"inherits the same accepted soft-failure as `_applyAttention`."* A maintainer who adds that grace window at the location the comment lives (`_applyAttention`) will leave `_applyBeacon` on the old, ungraced logic, and turn-done cards will false-clear while needs-input cards no longer do — a silent divergence in behavior the two comments promise stays identical. Extract one helper, e.g. `outputLandedAfter(line, ts) => (this._now() - (line.idleMs ?? 0)) > ts`, and call it from both so a future grace window lands once. Grounded: both call sites cited; the invariant they share is stated in their own comments.

**W2. Attacker-suppliable `transcriptPath` is stored now so a future feature will trust it unvalidated** — `server/src/sessions.js:196` (stored), `server/src/api.js:~176` (accepted from body) · confidence 50

**Status:** ✅ Resolved in `7e97b4b` — see below.
**Resolution:** Accepted as framed, resolved via the reviewer's explicitly-offered "validate-before-reading marker" option (comment-only, behavior-neutral). Added a `SECURITY` marker at both boundaries the value crosses: the `_beacons` map declaration + the storage assignment in `beacon()` (`sessions.js`), and the `BEACON_MAX` cap declaration in `api.js`. Each states the fact a future consumer needs — `transcriptPath` is attacker-suppliable, length-capped only, stored inertly, and MUST be canonicalized + confined to the Claude projects dir (reject `..`/UNC/symlink escapes) before any read — and rebuts the exact trap the finding named: "purely additive (ADR-0003)" sanctions the *storage*, not *trust on consumption*. Deliberately did **not** validate at storage: the field is never read today and validation belongs at the future read site (validate-at-use), so an eager storage-time check would be the wrong architecture and could reject a legitimate path. Closure check: a named guarded path — the three markers are the durable artifact a future author inherits; no runtime behavior to red→green (server 286/286 unchanged).

---

The beacon body's `transcriptPath` is length-capped (4096) but otherwise unvalidated — no canonicalization, no allow-listing to the Claude projects dir — and `beacon()` writes it straight onto the `_beacons` entry. ADR-0003 and the `_beacons` comment (`sessions.js:119-120`) are explicit that it is *"captured for a future transcript feature and never surfaced in the DTO,"* and that capturing it now makes the transcript-tailing feature *"purely additive."*

That framing is exactly the trap. The sanctioned decision covers *storing* the field inertly; it does not sanction *trusting it unvalidated when consumed*. A future author told the binding is "purely additive" will wire a JSONL tailer to `entry.transcriptPath` without re-deriving trust — and since the value originates in an HTTP body (the beacon is posted by a hook, but the endpoint authenticates the *operator token*, not the *path's provenance*), that tailer becomes an arbitrary-file-read / path-traversal sink (`../../../etc/...`, a UNC path, a symlink). Flag it at the boundary where the value enters and is persisted, so the future consumer inherits a validated path or an explicit "validate before reading" marker rather than a false sense of safety. This is forward-looking — there is no live exploit in this diff, hence confidence 50 — but the storage is introduced *by this change*, and the ADR's "purely additive" intent is what makes raising it now load-bearing.

### Notes

**N1. POST `/beacon` trusts `sessionId` with no ownership or authenticity check** — `server/src/sessions.js:186` · confidence 40

**Status:** ✋ Rejected — finding is not a defect (comment added in `c1218ab`).
**Resolution:** Rejected as a defect, in agreement with the finding's own conclusion ("within the sanctioned model, not a defect to fix"). Evidence the code is correct as written: the blast radius is cosmetic card state only — no spawn, no data exposure, no push (VC-10; a beacon never touches the notifier sinks), and the "dumb set" is deliberate parity with `POST /notify`'s identical `sessionId` model under ADR-0001's accepted single-operator XSS/trust ceiling (`_docs/adr/0001-*.md`). An ownership check here would be a new trust boundary the whole tool doesn't have. Added a durable `TRUST MODEL` comment on `beacon()` citing ADR-0001 and the cosmetic-only ceiling so a future reviewer doesn't re-flag correct code. No behavior change.

---

`beacon()` acts on a present `sessionId` as a "dumb set" — any caller past the operator token can force any live line into `turn-done`/`running`, or wipe a Claude-line marker with `SessionEnd`, for a line they have nothing to do with. Impact is confined to cosmetic card state (no spawn, no data exposure, no push — VC-10), and it is deliberate parity with `POST /notify`'s existing `sessionId` model under ADR-0001's accepted single-operator XSS/trust ceiling. So this is within the sanctioned model, not a new hole — recorded as the closest security-relevant assumption the change rides on, not a defect to fix. Low confidence because the decision is documented.

**N2. Empty-string `sessionId` passes validation, then falls through to the `cwd` fallback** — `server/src/sessions.js:186` · confidence 45

**Status:** ✅ Resolved in `895b68d` — see below.
**Resolution:** Accepted as framed — there is a genuine code/comment disagreement worth reconciling — but resolved on the **comment** side, because the *code* behavior is the intended one. An empty `sessionId` falling through to `cwd` is desirable, not a bug: an empty `AGENT_RELAY_SESSION` is the "hook couldn't resolve a line id" sentinel (a non-board-spawned line), so the `cwd` backstop is exactly what should fire; it can match no live line by id anyway. The reviewer's alternative fixes were both regressions — rejecting `''` in validation, or set-and-pruning it, would kill that backstop and turn the beacon into a silent no-op. Took the reviewer's second offered option: clarified the header comment (the "never fall through" invariant governs a present *non-empty* id) and added an inline note at the falsy `if (sessionId)` check, so code and comment now agree. Comment-only, no behavior change (server 286/286 unchanged, incl. the existing VC-12 fallthrough tests).

---

`validateBeaconBody` accepts `sessionId: ''` (a string within cap), but `beacon()`'s `if (sessionId)` treats it as absent and drops to the `cwd` branch — contradicting the invariant the surrounding comment states so emphatically: *"A present-but-unmatched `sessionId` must never fall through to `cwd`."* In practice this is harmless-to-arguably-correct (an empty id can match no live line, so falling back to `cwd` is more useful than a guaranteed no-op) and a real hook never emits an empty `AGENT_RELAY_SESSION`, so confidence is low. Worth a one-line acknowledgement — either treat `''` as genuinely present (reject, or set-and-prune like any unmatched id) or note in the comment that an empty string is intentionally the "absent" sentinel — so the code and its emphatic comment stop disagreeing.

---

### Promised-vs-delivered sweep (validation-contract.md)

All 15 live `VC-n` assertions are delivered and covered; no absence findings. Spot-checks: **VC-3** — `turn-done` maps to the `done` StatusDot variant backed by `--status-done` (purple, distinct from `attention`/blue) in `_docs/design-system/tokens/colors.css` and `StatusDot.jsx`, and renders in the live grid while `exited` renders in the separate collapsed section, so the three stay distinguishable by color in a static screenshot (test: `attention.test.ts` "turn-done decodes to a distinct-color, non-pulsing dot"). **VC-4** — `attentionRank` (needs-input 0 < turn-done 1 < rest 2) drives the stable `SessionsScreen` sort. **VC-9** — the boot-nonce void is tested; re-establishment rides `beacon()`'s upsert. **VC-14** — exited lines flow through `endedToDto`, never `_applyBeacon`, and the id is pruned; tested. Nothing struck/`SUPERSEDED` in the contract.
