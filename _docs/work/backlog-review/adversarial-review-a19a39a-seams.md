# Adversarial Review: seam pass + index (backlog review `3bd5d96..a19a39a`)

**Scope:** cross-slice contracts and cross-leaf patterns the five isolated slice reviews couldn't see: the status-vocabulary contract (server DTO → `types.ts` → card table), middleware ordering in `index.js`, the WS input path vs the attention flag, localStorage idioms, and deploy/version-skew behavior.
**Reviewed:** `3bd5d96..a19a39a` (seam pass run by the orchestrator over full files at HEAD; working tree clean)
**Verdict:** CLEAN (notes only — every cross-slice contract checked actually holds)

## Contracts checked and HELD (no findings)

- **Status vocabulary end-to-end:** server emits `running | idle | needs-input | exited`; `types.ts` deliberately keeps `status: string` for skew tolerance; `SessionsScreen`'s `ATTENTION` table covers all live values with an explicit unknown-status fallback; `exited` routes to the tombstone section. No value falls through. (The *quality* of the fallback is attention-slice N1; the vocabulary sync-point fragility is attention-slice W1.)
- **Middleware ordering:** both `/api` routers (API + pairing) mount behind `authMiddleware` *before* the static router; static's SPA fallback excludes `/api`/`/sessions`; the WS upgrade rides the HTTP server, not Express — the unauthenticated static mount cannot shadow or pre-empt an authenticated route.
- **Composer → attention clear:** the new composer/chips path sends ordinary WS `input` frames, so `ws.js`'s `clearAttention` fires for mobile answers exactly as for typed ones — the two features compose correctly.
- **One idle definition:** `wait.js DEFAULT_IDLE_MS` → `board-client` re-export → `sessions.js` is the only threshold in play; no third definition grew during the range.
- **Env-injection seam:** `AGENT_RELAY_SESSION` is injected in `board.js createLine` — the shared kernel path — so `sb`/MCP-spawned lines carry it too (broader than the intent doc's minimum), with cwd-match as the documented backstop.

### Notes

**S1. Cross-leaf pattern: pure decode/derivation tables left inline in screens** — `client/src/screens/SessionsScreen.jsx:101-109` (ATTENTION table, attention slice W1) + `client/src/screens/TerminalScreen.jsx:86-88` (`matchReadout`, qol slice N3) · confidence 65
Two independent slices, same breach of the repo's own extract-to-core convention, both times *next to* sibling logic that did get extracted and tested. This is the drift pattern the convention exists to stop — remediate both the same way (small `core/` modules with tests) and treat a third occurrence as a signal to add the rule to the PR checklist.

**S2. Deploy/version-skew is the recurring blind spot of the range** — `server/src/static.js:37-48` (static slice W1) + `client/src/screens/SessionsScreen.jsx:109` (attention slice N1) · confidence 55
Same-origin static serving created a new deployment reality — long-lived tabs running old bundles against a new server — and two slices independently mishandle it: a stale tab's asset request gets 200 HTML instead of a 404, and a stale tab renders a new urgent status as a dead-looking offline dot. Neither slice caused the other, but they compound: the failure mode of *both* is "the operator's open phone tab quietly behaves wrong after a deploy." Worth one deliberate pass on "what does an old bundle do against a new server" whenever the DTO or asset layout changes.

**S3. Two localStorage idioms now coexist** — `client/src/screens/SessionsScreen.jsx:30-48` (`ar-claude-model`/`ar-claude-effort`, raw inline get/set) vs `client/src/core/templates.ts` (structured store, parse-guarded, tested) · confidence 35
Consolidation is explicitly deferred to spawn-templates phase 2 (the server-side store), so NOTE only: when phase 2 lands, fold the claude-flag persistence into the same store shape rather than leaving the ad-hoc keys behind.

**S4. Hook-vs-output ordering assumption in the needs-input clear** — `server/src/sessions.js:157-166` · recorded as notify slice N5 (orchestrator seam pass and the notify Maintainer converged on it independently; both low-confidence, held at NOTE there — not double-counted here).

### Summary

The seams are in better shape than the leaves: every contract that crosses a slice boundary was found actually enforced, mostly because the range consistently routed shared vocabulary through single modules (`wait.js`, `board-client`, `types.ts`, `toDto`). The two systemic observations — S1 (convention drift on inline pure logic) and S2 (version-skew blindness) — are patterns to fix once and watch for, not per-line defects.

---

## Index: backlog review `3bd5d96..a19a39a` (2026-07-06)

Range: 13 commits. Four features carried prior reviews (client-core extraction, model/effort selection, tombstones — and tunnel+QR, verified CLEARED) and were excluded by agreement; the five never-reviewed features were sliced, reviewed by isolated persona panels (notify ran as a 3-lens fan-out), and closed with this seam pass. No CRITICALs anywhere in the range.

| Slice | File | Verdict | Top finding |
|---|---|---|---|
| static serving (`82d28f2`) | `adversarial-review-a19a39a-static.md` | CONCERNS | W1: SPA fallback masks missing hashed assets as 200 HTML |
| attention states (`0c0edf4`) | `adversarial-review-a19a39a-attention.md` | CLEAN (1 W@55) | W1: ATTENTION map un-extracted; sole vocab sync point |
| notify + hook bridge (`5565480`+`44c26d3`) | `adversarial-review-a19a39a-notify.md` | CONCERNS | W1: notifier failures never logged (silent-forever) |
| RDP launcher (`2902e0f`) | `adversarial-review-a19a39a-rdp.md` | CONCERNS | W1: zero-geometry read fail-opens to *phone* |
| terminal QoL + templates (`b55e776`+`a19a39a`) | `adversarial-review-a19a39a-qol.md` | CONCERNS | W1: composer clears text on silently-dropped send |
| seam pass | this file | CLEAN | S1/S2 systemic patterns |

**Fix-first across the whole range:** rdp W1 (conf 80 — hostile desktop launch on the launcher's own anticipated failure), notify W1 (conf 75 — the alerting feature fails silently exactly when unwatched), qol W1 (conf 70 — mobile answers silently eaten while reconnecting), static W1 (conf 70 — post-deploy stale tabs get HTML-as-JS), notify W5 (conf 55 — push-channel phishing escapes the accepted XSS envelope).

**Remediation (2026-07-07, branch `fix/backlog-review-remediation`):** **every warning in the range is now fixed**, one commit each — first the five fix-first findings in ranked order, then the second pass (notify W2/W3/W4, qol W2/W3/W4, static W2, rdp W2, attention W1). Three notes rode along with their warnings: static N1 (case-insensitive reserved prefixes, with W2), attention N1 (loud unknown fallback, with W1), and S1's first half (the ATTENTION table extraction; `matchReadout`/qol N3 remains). Resolutions are annotated per-finding in each slice doc. Still open: the remaining notes only — static N2, notify N1–N5, rdp N1–N6, qol N1/N2/N3/N4/N5/N6/N7, seams S2 (a practice, not a patch) and S3 (sanctioned-deferred to templates phase 2).
