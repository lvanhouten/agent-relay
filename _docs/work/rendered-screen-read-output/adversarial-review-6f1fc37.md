# Adversarial Review: rendered-screen-read-output (whole branch)

**Scope:** `feat/rendered-screen-read-output` vs `main`. 8 reviewable code files (~690 LoC churn), all under `server/board/`: `screen-render.js` (new, VT-emulator wrapper), `board.js` (per-line screen lifecycle + `screen` control command + async dispatch), `mcp-server.js` (`switchboard_read_screen` tool + `readScreen`), `sb.js` (`sb screen <id>`), `server/package.json` / `package-lock.json` (`@xterm/headless` dep), plus unit/e2e tests (`screen-render.test.js`, `board.test.js`, `mcp-server.test.js`, `screen-command.e2e.test.js`). Docs (PRD, ADR 0002, validation-contract, CONTEXT.md) reviewed as authoritative intent, not scored.
**Reviewed:** `44f6ab1..6f1fc37` (no working-tree/staged changes)
**Verdict:** CONCERNS (2 warnings, both grounded; no criticals)

### Summary

A clean, additive, well-tested feature: the pure serializer (`screen-render.js`) and the lifecycle helper (`makeScreenLifecycle`) are correctly factored and directly unit-tested, every VC-1..VC-11 assertion is delivered, and the two failure replies (never-existed vs exited) are asserted distinct at three layers. The risk profile is concentrated entirely in the **one structural change to the shared control-plane dispatch** — making `handle` async so the `screen` command can `await` a snapshot. W2 (a screen read racing a line's exit reads/rebuilds an emulator disposed out from under it) is the finding to weigh before merge; W1 (the async dispatch quietly relaxes the control plane's reply-ordering guarantee) is latent today but the in-code justification for it is incomplete.

## Priority ranking

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| W1 | WARNING | 55 | Async `handle` relaxes control-plane reply ordering; in-code justification is incomplete | (open) |
| W2 | WARNING | 55 | Screen read racing line exit: TOCTOU between liveness check and the awaited snapshot | (open) |
| N1 | NOTE | 55 | First screen read seeds by queuing up to 2000 scrollback chunks on the board's event loop | (open) |
| N2 | NOTE | 45 | `endedLines.list().find(...)` copies the ring per not-live read; registry lacks `get(id)` | (open) |
| N3 | NOTE | 40 | Load-bearing flush invariant rides on the `@xterm/headless ^6.0.0` caret range | (open) |
| N4 | NOTE | 40 | Rendered screen exposes raw-output-grade content over the control plane; gated only by the boot secret | (open) |

### Warnings

**W1. Async `handle` relaxes the control-plane reply-ordering guarantee; the in-code justification is incomplete** — `server/board/board.js:464-480` · confidence 55

Making `handle` `async` (to `await` the `screen` snapshot) changed the dispatch contract. The loop dispatches every command in a chunk without awaiting:

```js
const ret = handle(m, sock);
if (ret && typeof ret.then === 'function') { ret.catch(...); }
```

The adjacent comment claims *"sync commands still write their reply before the first await, so reply ordering holds."* That reasoning only establishes ordering *within a single command's* handling — it does **not** establish cross-command ordering. If a `screen` (async, reply written only after its `await`) and any reply-producing command are dispatched on the same socket, the later sync command's reply is written **first**, reordering responses on that connection.

This is **latent, not live**: `rpc()` (`lib.js:241`) is strictly one-shot — it writes one command, reads exactly one reply line, then `sock.end()`s — so every reply-producing command (`new`/`list`/`join`/`end`/`forget`/`screen`) is alone on its socket today. The only persistent-socket traffic is `resize`, which writes no reply. So nothing currently pipelines a `screen` with another reply-producing command.

The defect is that the code documents a guarantee it no longer provides. The `resize` path already establishes "hold a control socket open and send commands on it" as a supported pattern; the day any client sends a reply-producing command on such a socket, replies can silently transpose with no framing to detect it (the control plane is positional newline-delimited JSON, not request-id-tagged). Either await commands sequentially in the loop, or correct the comment to state the ordering guarantee now depends on callers never pipelining reply-producing commands.

**W2. Screen read racing a line's exit: TOCTOU between the liveness check and the awaited snapshot** — `server/board/board.js:404-419` · confidence 55

The `screen` handler checks liveness, then `await`s the snapshot:

```js
const s = sessions.get(m.id);
if (s) {
  const snap = await s.screen.read();   // <-- yields to the event loop
  sock.write(JSON.stringify({ ok: true, boot: BOOT, ...snap }) + '\n');
}
```

`s.screen.read()` is `ensure().snapshot()`, and `snapshot()` yields at `await new Promise(resolve => term.write('', resolve))` (`screen-render.js:47`). During that yield, `p.onExit` can fire for the same line and run `s.screen.dispose()` (`board.js:250`), which calls `term.dispose()` on the very instance the in-flight `snapshot()` is about to read. Concrete interleavings, all reachable because there is no re-check after the await:

- **Already-initialized screen:** `onExit` disposes the live `term` mid-flush; `snapshot()` then reads `term.buffer.active` on a disposed terminal → likely throws → `read()` rejects → the handler writes **no reply** → the client blocks until the 10s `RPC_TIMEOUT_MS` and surfaces a generic "screen read failed" instead of the intended `ended:true`/exit-code error (a direct VC-9 miss under the race).
- **First read (lazy-init):** `ensure()` rebuilds a *new* emulator from `s.buf` after `onExit`'s dispose already ran, returning `ok:true` with a full grid for a line the PRD says must error — and that freshly built emulator is never disposed (`onExit` is already past its dispose call), leaking until `s` is GC'd.

`makeScreenLifecycle` deliberately has no notion of "line is dead" — the only guard is the now-stale `sessions.get` at the top of the handler. The window is narrow (one+ event-loop turns while an actively-exiting line is screen-read) and the worst case is a 10s hang or a contract-violating stale grid, not a crash (the dispatch `.catch` prevents unhandled rejection). Guard it by re-checking `sessions.has(m.id)` after the await before writing `ok:true`, or by having the lifecycle refuse a read once disposed rather than silently rebuilding.

### Notes

**N1. First screen read seeds by queuing up to 2000 scrollback chunks onto the board's single event loop** — `server/board/board.js:152-158` · confidence 55

`ensure()` replays the whole scrollback into a fresh emulator on first read: `for (const chunk of getScrollback()) screen.write(chunk)`. `SCROLLBACK` is 2000 chunks, and the board is single-threaded — the xterm parse work for a busy line's full window happens on the loop that serves every other line's I/O. Bounded (2000 chunks) and one-time per line (every read after init is incremental), so this is a NOTE, not a warning — but ADR 0002 discusses the seed's *truncation* exposure, not its *latency*. Worth a line acknowledging the one-time first-read parse cost, since a heavily-repainting Claude line will routinely carry a full window of large chunks. `n = 2000` chunks, one-time; realistic worst-case parse is milliseconds, but it is a synchronous stall for all lines during that window.

**N2. `endedLines.list().find(...)` copies the whole ring per not-live screen read; the registry has no `get(id)`** — `server/board/board.js:415` · confidence 45

The not-live branch does `endedLines.list().find(t => t.id === m.id)`. `makeEndedRegistry` (`board.js:123`) exposes `record`/`forget`/`list` only, and `list()` returns `items.slice()` — a full copy of up to 20 tombstones allocated on every screen read of a non-live id, just to `.find` one. `forget` already does an internal `findIndex`; a `get(id)` method on the registry would be the reuse target and would keep the tombstone lookup encapsulated (the handler currently reaches through `list()` into the ring's internals). Small blast radius (cap 20), so low confidence — an efficiency + encapsulation nit, not a correctness issue.

**N3. The load-bearing flush invariant rides on the `@xterm/headless ^6.0.0` caret range** — `server/package.json:12`, `server/board/screen-render.js:46-47` · confidence 40

`snapshot()`'s correctness depends on `term.write('', resolve)` invoking the callback only *after* all previously-queued writes have drained — an internal write-buffer behavior of xterm, not a documented API contract. The reliance is well-documented in `screen-render.js:6-14` and spike-tested (SPIKE 3), which is the mitigation. But the dep is pinned `^6.0.0`, so a minor/patch bump that short-circuits empty writes (calling the callback synchronously, before prior writes parse) would silently break flush-before-read and produce torn/stale snapshots. `^` is the repo convention, so pinning this one exactly would be inconsistent — the honest fix is to keep SPIKE 3 as the tripwire and note that it *is* the regression guard for a dependency-upgrade break, so it is never removed as "just a spike."

**N4. The rendered screen exposes raw-output-grade content over the control plane, gated only by the per-boot secret** — `server/board/board.js:404-411` · confidence 40

Security has no new *boundary* here — `screen` is dispatched only post-handshake, behind the same per-boot access secret as every other control command, and the reply is not logged (unlike `read_output`, no cursor/`seen` state is persisted either). The security-relevant assumption to state explicitly: the rendered grid can contain anything on screen — a credential typed at a prompt, PHI in a TUI, a masked-in-raw-stream value that renders in plaintext — at the same sensitivity as `read_output`, and its entire confidentiality rests on the secret gate that the CONTEXT/CLAUDE notes already flag as resting on an *unverified* Windows secret-file ACL (the open P2 issue). No change in exposure surface from this feature; it inherits the existing model and the existing open question about that model.

---

## Promised-vs-delivered sweep (validation-contract.md)

All 11 live assertions are delivered; no missing-promise findings.

- **VC-1** (no ANSI in grid) — `screen-render.js` strips escapes; asserted (`screen-render.test.js:62`, SPIKE 2).
- **VC-2 / VC-3** (caret on highlighted option; moves after keystroke) — caret survives rendering (SPIKE 2, `:71`); VC-3's "moves after keystroke" is delivered structurally by the live feed and proven via TICK-freshness in the e2e (`:84`) rather than a literal menu keystroke — acceptable, freshness is the underlying mechanism.
- **VC-4** (cursor row/col + dims) — `:108`, e2e `:79`.
- **VC-5** (trailing trim, leading/interior preserved) — `:82`, `:100`.
- **VC-6** (bounded by dims) — `scrollback:0`; `:145`.
- **VC-7** (resize dims match, not sheared) — unit `:131` (true reflow of a 40-char line) + e2e `:96`. Note the e2e's `widest <= 40` is satisfied trivially by short TICK content; the real not-sheared proof is the unit test.
- **VC-8** (`sb screen` prints grid, caret in place) — `sb.js:103` prints `r.grid` raw; no dedicated test, consistent with the PRD's "thin dispatch, no test" decision.
- **VC-9** (exited → error with exit code) — e2e `:112`, mcp `:29` (see W2 for the race where this regresses).
- **VC-10** (never-existed → distinct message) — asserted distinct at board (`board.test.js`), e2e (`:116`), and mcp (`:47`) layers.
- **VC-11** (raw `read_output` unchanged) — `read_output` is untouched by the diff; delivered by non-modification.
