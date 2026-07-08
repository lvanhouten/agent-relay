## Validation-Contract Coverage: rendered-screen-read-output — 44f6ab1..125b784

**Contract:** _docs/work/rendered-screen-read-output/validation-contract.md
**Range:** 44f6ab17b58424e67460437ee279e7330d1b4778..125b784ae188aaaa9b0fc2ecde9951c0390743f7 (feature commits + remediation fixes reachable by SHA)
**Verdict:** DELIVERED

| VC-n | Status | Evidence / gap |
|------|--------|----------------|
| VC-1 | ✅ delivered | `screen-render.js:snapshot` serializes via `translateToString(false)`; the VT emulator consumes all escapes, so the grid is plain text. Test `no ANSI escapes survive` asserts `!hasAnsi(snap.grid)`. Exposed through board `screen` cmd and mcp `readScreen`. |
| VC-2 | ✅ delivered | Caret preserved as an ordinary glyph; leading spaces position it (`snapshot` keeps leading/interior spacing). Tests `SPIKE 2` (`❯ 1. Yes` verbatim) and `a ❯ selection caret renders in the expected cell` (`indexOf('❯') === 2`). |
| VC-3 | ✅ delivered | Live feed `board.js` `s.screen.feed(d)` in `p.onData` keeps the emulator current; a repaint after a keystroke (via existing `switchboard_send_input`) lands in the next `snapshot`, and VC-2 shows the caret renders in-place. `screen-command.e2e.test.js` step (3) proves a later read reflects newer output (higher TICK). |
| VC-4 | ✅ delivered | `snapshot` returns `{ grid, cursor:{row,col}, cols, rows }`; board passes through (`{ ok:true, boot, ...snap }`); mcp `readScreen` returns all four. Test `snapshot reports cursor row/col ... and current dims`. |
| VC-5 | ✅ delivered | `snapshot`: `text.replace(/\s+$/, '')` right-trims each row; `while (out[last] === '') out.pop()` drops trailing blank rows; leading/interior kept. Tests `rows are right-trimmed and leading/interior spacing is preserved`, `trailing all-blank rows are dropped entirely`, `interior all-blank rows ... are preserved`. |
| VC-6 | ✅ delivered | `createScreen` sets `scrollback: 0`; `snapshot` iterates only `term.rows`. Test `snapshot size stays bounded by the dimensions regardless of output volume` feeds 5000 lines and asserts row count ≤ `rows` and length ≤ `rows*(cols+1)`. |
| VC-7 | ✅ delivered | `screen-render.js` `resize()`; `board.js` `applyMin` resizes the screen in lockstep with the PTY; `snapshot` reports `term.cols/rows`. Tests `after resize, snapshot reflects new dims and lays content to the new width` and e2e step (4) (`widest <= 40`). |
| VC-8 | ✅ delivered | `sb.js` `screen` case: `console.log(r.grid)` prints the `\n`-joined plain-text grid (caret preserved) to stdout; usage line added. |
| VC-9 | ✅ delivered | board `screen` not-live branch → `{ ok:false, ended:true, exitCode, reason }` from `endedLines.get(id)`; mcp `readScreen` throws `line <id> has ended (exit N)` (ELINEENDED); sb prints same. e2e step (5): exited line → `ok:false, ended:true, exitCode:3`. |
| VC-10 | ✅ delivered | board `screen` → `{ ok:false, ended:false }` for a never-existed id; mcp throws `no such line: <id>` (ENOLINE), distinct code from ELINEENDED; sb prints `no such line`. e2e step (1) + `notDeepStrictEqual` distinctness assertion (step 5). |
| VC-11 | ✅ delivered | `switchboard_read_output` / raw delta read are untouched by the diff; the feature adds a separate `switchboard_read_screen` tool. In `p.onData` the raw broadcast (`for (const c of s.clients) c.write(d)`) and scrollback push are unchanged — `s.screen.feed(d)` is additive and no-op until first screen read. |

### Undelivered assertions

None.

### Strike reconciliation

No assertion in the contract carries a `SUPERSEDED` marker, so reconciliation is vacuous. `briefs/STATUS.md` records three build deviations (01 right-trim regex, 03 generic-failure branch, 02 `handle()` async) — each explicitly dispositioned **"Contract: no VC-n affected"**. No strike was applied and none was owed, so no live assertion is at risk of a hidden gap behind a relaxed oracle.

### Summary

DELIVERED. 11 live assertions, 11 delivered, 0 undelivered, 0 superseded. Every promised behavior of the rendered-screen read — plain-text grid, caret preservation, live-feed freshness, cursor/dim reporting, whitespace trimming, dimension-bounded size, resize layout, the `sb screen` CLI, and the two distinct exited/never-existed errors — is delivered across `screen-render.js`, `board.js`, `mcp-server.js`, and `sb.js`, each with a covering test; and the existing raw-output delta read is verified untouched.
