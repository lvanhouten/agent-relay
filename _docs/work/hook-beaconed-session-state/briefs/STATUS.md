# Execution status — hook-beaconed-session-state

| Brief | Status | Wave | Merged SHA | Criteria | Note |
|---|---|---|---|---|---|
| 01-server-beacon-plumbing | integrated | 1 | 406e9ac | 13/13 | spec-compliance reviewed (all met); server suite 284/284 |
| 02-client-turn-done-rendering | integrated | 1 | 7dc3df3 | 7/7 | client suite 103/103; typecheck confirmed clean post-install |

## Handoff notes
- **01-server-beacon-plumbing:** DTO gains NO new fields — beacon state is expressed only through the existing `status` string, which can now be `'turn-done'`. `transcriptPath`/`claudeSessionId` are stored internally on `_beacons`, deliberately NOT surfaced in the DTO (future transcript feature). `list()` status precedence is fixed: needs-input > turn-done > running(Claude lines) > idleMs heuristic; exited tombstones never pass through the beacon overlay. (contract-change) — consumed correctly by 02 (renders on `status === 'turn-done'`).
- **02-client-turn-done-rendering:** design-system source of truth for status color tokens/StatusDot variants is `_docs/design-system/components/core/StatusDot.jsx` + `tokens/colors.css` (imported live via `@ds` alias) — NOT the generated `_ds_bundle.js`/`_ds_manifest.json` browsing-tool artifacts, which the client never imports and are left untouched. (constraint)

## Deviations
- **01-server-beacon-plumbing:** refactored `flagAttentionByCwd()` to delegate to a new shared private `_resolveLiveIdByCwd()` (used by both notify's and beacon's cwd fallback) instead of duplicating the list-RPC+match logic; behavior unchanged, all pre-existing tests green. **Contract:** no VC-n affected.
- **01-server-beacon-plumbing:** worktree had no `node_modules`; ran `npm install` to run the express-dependent api tests — installed deps are gitignored, not part of the commit (environmental only). **Contract:** no VC-n affected.
- **02-client-turn-done-rendering:** `StatusDot.d.ts`'s `SessionStatus` union was missing `'attention'` even though the component/app already used it at runtime; added both `'attention'` and `'done'` to keep the type declaration truthful. **Contract:** no VC-n affected.
