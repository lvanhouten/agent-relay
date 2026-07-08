## Validation-Contract Coverage: hook-beaconed-session-state — ccca4d6..4309003

**Contract:** _docs/work/hook-beaconed-session-state/validation-contract.md
**Range:** ccca4d6b45ceed73dd5ed66d4001d619f6406e07..4309003ecf550d11f76eadd0d7cbf13ecdb87da3 (the merged feature branch)
**Verdict:** DELIVERED

15 live assertions, 15 delivered, 0 undelivered, 0 superseded. No `SUPERSEDED` strikes exist in the contract, so strike reconciliation is vacuously clean; `briefs/STATUS.md` records `**Contract:** no VC-n affected` for all three deviations, consistent with an unstruck contract.

| VC-n | Status | Evidence / gap |
|------|--------|----------------|
| VC-1 | ✅ delivered | `BoardSessions._applyBeacon:293` (server/src/sessions.js) — a Claude line (has `_beacons` entry) with `turnDoneAt == null` returns `status:'running'` regardless of idleMs; SessionStart creates the entry with `turnDoneAt=null` (`beacon:217`) |
| VC-2 | ✅ delivered | `_applyBeacon:290` returns `status:'turn-done'` when a live `turnDoneAt` has no output after it; Stop sets `turnDoneAt=this._now()` (`beacon:218`) |
| VC-3 | ✅ delivered | color carries the distinction: `--status-done: purple-500/400` vs `--status-attention: blue-500/400` (colors.css:98–99,158–159); `turn-done` maps to `dot:'done', pulse:false` (attention.ts:39); exited tombstones route to the Recently-exited section (SessionsScreen.jsx:588,675) |
| VC-4 | ✅ delivered | `attentionRank`: needs-input 0 < turn-done 1 < other 2 (attention.ts:60–67); `live` grid sorted by it with a stable sort (SessionsScreen.jsx:585–587) |
| VC-5 | ✅ delivered | `_applyBeacon:290–292` — output landed after `turnDoneAt` resets it to null (keeps the entry) and returns `status:'running'` |
| VC-6 | ✅ delivered | WS `input` frame → `sessions.clearAttention(id)` (ws.js:90); `clearAttention:230–234` resets the beacon entry's `turnDoneAt` to null so the line leaves turn-done |
| VC-7 | ✅ delivered | `list:330` composes `_applyAttention(_applyBeacon(dto,line),line)` — beacon sets turn-done first, the needs-input overlay runs last and wins (documented at `_applyBeacon:284`) |
| VC-8 | ✅ delivered | `_applyBeacon:287–288` passes a non-Claude line (no `_beacons` entry) through unchanged; `toDto:61` keeps the idleMs `running`/`idle` heuristic |
| VC-9 | ✅ delivered | `_beacons` is web-tier-only and lost on relay restart; the next beacon re-establishes the Claude line — Stop self-heals by creating the entry if absent (`beacon:214,218`), SessionStart upserts (`beacon:214,217`); boot-nonce clear is guarded against firing on a null→first-seen transition (`list:314–320`) |
| VC-10 | ✅ delivered | POST `/beacon` handler (api.js:174–189) never touches `notifyAll`/the notifier sinks; only `/notify` pushes (api.js:159) |
| VC-11 | ✅ delivered | `validateBeaconBody` rejects an unrecognized event and oversized fields with 400 (api.js:64–69,178–179); a non-JSON body is refused 415 before any state change (api.js:176) |
| VC-12 | ✅ delivered | `beacon:206–208` — a present non-empty `sessionId` is used directly and never falls through to `cwd`, so it can't flag a different same-dir line; an unmatched id/exited line is set inertly and pruned on the next `list` (`list:323–325`); an empty string is the intentional cwd-fallback sentinel |
| VC-13 | ✅ delivered | the `cwd`-resolution path throws `BoardUnreachableError` on a failed list RPC (`_resolveLiveIdByCwd:171–175`), which api.js maps to a 503 (`e.boardUnreachable`, api.js:188); the sessionId path issues no board RPC, so a down board yields no generic 500 either way |
| VC-14 | ✅ delivered | tombstones map via `endedToDto` → `status:'exited'` and are appended outside the beacon overlay (`list:329–331`); `_beacons` entries for non-live ids are pruned (`list:325`), so a Stop for an exited line never surfaces as turn-done |
| VC-15 | ✅ delivered | `beacon:210–213` — SessionEnd deletes the `_beacons` entry, so `_applyBeacon` passes the line through unchanged and it reverts to the idleMs heuristic |

### Summary

DELIVERED — every one of the 15 live assertions is delivered by the merged feature branch, with a cited file:symbol per row; nothing is undelivered, nothing superseded. No `SUPERSEDED` strikes exist in the contract, so the strike-reconciliation guard (a struck-but-unbacked assertion attested live) has nothing to flag — consistent with `briefs/STATUS.md`'s three `no VC-n affected` dispositions. This is a text-based coverage attestation against the diff and full files, not a behavioral one; the execution-side check remains the separate browser-verify slice.
