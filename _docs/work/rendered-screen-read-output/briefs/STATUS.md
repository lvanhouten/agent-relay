# Execution status — rendered-screen-read-output

| Brief | Status | Wave | Merged SHA | Criteria | Note |
|---|---|---|---|---|---|
| 01-screen-render | integrated | 1 | af8a9f6 | 10/10 | |
| 02-board-screen-command | integrated | 2 | 29b6ae6 | 10/10 | exclusive; suite flake noted below |
| 03-read-screen-mcp-tool | pending | 3 | — | — | |
| 04-sb-screen-command | pending | 3 | — | — | |

Dependency graph: 01 → 02 → {03, 04}. Waves: W1={01}, W2={02, exclusive}, W3={03, 04}.

## Handoff notes
- **01-screen-render → [02, 03, 04]:** module at `server/board/screen-render.js` exporting `{ createScreen }`. `createScreen(cols, rows)` → `{ write(bytes)->Promise, resize(cols,rows), snapshot()->Promise<{grid,cursor:{row,col},cols,rows}>, dispose() }`. **`snapshot()` is async — must be awaited** (flush-before-read). `write()` accepts string or Buffer/Uint8Array. (contract-change)
- **01-screen-render → [02]:** active/alternate buffer is what serializes; `cursor.row/col` are the emulator's absolute untrimmed coords (`baseY+cursorY`, `cursorX`), not indices into the trimmed grid. (constraint)
- **02-board-screen-command → [03, 04]:** `screen` control command reply contract — live line → `{ ok:true, boot, grid, cursor:{row,col}, cols, rows }` (brief-01 snapshot fields passed through as-is; cursor coords absolute untrimmed). Not-live → `{ ok:false, ended:true, exitCode, reason }` for an exited line, `{ ok:false, ended:false }` for a never-existed id. **Distinguish the two failures by `ended`, not by both being falsy.** Request shape `{ cmd:'screen', id }`. (contract-change)
- **02-board-screen-command → [03, 04]:** `screen` is a stateless snapshot each call — NO read cursor (unlike delta-based `read_output`). Consumers must not cache or namespace any per-line screen cursor. (constraint)

## Deviations
- **01-screen-render:** used explicit regex right-trim in `snapshot()` instead of xterm's `translateToString(true)` (which only trims null cells, not written trailing spaces) — required to satisfy the right-trim/blank-row-drop criteria. **Contract:** no VC-n affected.
- **02-board-screen-command:** no spec deviation. **Integration note (not a deviation):** `handle()` became `async` (dispatcher awaits/.catches; sync commands still reply before the first await). The new `screen-command.e2e.test.js` spawns a real board, adding concurrent-board load to the full `node --test` run; under that load the *pre-existing, untouched* `tombstone.e2e.test.js` flaked once ("board closed the connection before replying") — passed 3/3 in isolation and 2nd/2nd full-suite run (239/239). Latent e2e timing flake, slightly more likely with the added board; flagged for review, not a correctness defect. **Contract:** no VC-n affected.
