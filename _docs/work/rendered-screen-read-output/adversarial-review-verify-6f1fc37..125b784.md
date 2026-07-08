# Remediation Verification: rendered-screen-read-output — `6f1fc37..125b784`

**Verifies:** `_docs/work/rendered-screen-read-output/adversarial-review-6f1fc37.md`
**Range:** `6f1fc37..125b784ae188aaaa9b0fc2ecde9951c0390743f7` (code fixes `eaa64c7..837200b`; `125b784` fills resolution SHAs + updates the priority table)
**Verdict:** CLEARED

### Summary

Every one of the six original findings is confirmed closed. The two code fixes (W2 lifecycle guard, N2 registry `get`) hold under independent scrutiny; the four comment/doc clarifications (W1, N1, N3, N4) accurately state the real contracts and are behavior-neutral. The full server suite is green at the fix head (249/249). The new-defect sweep raised **one NOTE** — on the narrow already-initialized mid-flush exit race, `snapshot()` reads `term.buffer.active` on the just-disposed terminal before `read()` discards the grid, emitting an `@xterm/headless` internal error log and leaking one disposable per race hit — non-fatal, no CRITICAL, does not block merge. Safe to merge the worktree.

## Priority ranking (new findings only)

| ID | Severity | Conf | Finding | Status |
|----|----------|------|---------|--------|
| N1 | NOTE | 75 | Mid-flush exit race: `snapshot()` touches the disposed buffer before `read()` discards it, logging an xterm leak-warning + leaking one disposable | (open) |

### Close-out (original findings)

| Orig ID | Claimed | Verify verdict | Evidence |
|---------|---------|----------------|----------|
| W1 | Resolved (B) | ✅ Confirmed closed | Comment at `board.js:513-530` now states the real contract; verified accurate against code: `rpc()` (`lib.js`) is one-shot (one command → one reply → `sock.end()`), and the only persistent-socket command (`resize`) writes no reply, so no caller pipelines two reply-producing commands. Diff shows only comment lines changed in that hunk — behavior-neutral. |
| W2 | Resolved (A) | ✅ Confirmed closed | Both race legs return `null` → handler falls to the exited-line reply. Lazy-init leg: `ensure()` returns null when `disposed`, no emulator built (test `constructed()===0`). Already-init mid-flush leg: real-terminal repro confirms the flush **resolves** (does not hang — kills the RPC_TIMEOUT_MS concern) and `read()`'s post-await `disposed` check discards the grid, returning null. `onExit` records the tombstone synchronously in the same tick as `dispose()` (`board.js:281,285`), so `disposed=true` ⟹ tombstone present when the handler queries `endedLines.get` → correct `ended:true`/exit-code reply (VC-9 holds under the race). 3 mutation-verified unit tests. (See new N1 for a minor side effect of the chosen approach.) |
| N1 | Resolved (A) | ✅ Confirmed closed | Comment at the seed loop in `ensure()` acknowledges the one-time first-read parse cost (up to `SCROLLBACK`=2000 chunks synchronous on the single event loop). Behavior-neutral. |
| N2 | Resolved (A) | ✅ Confirmed closed | `get(id) => items.find(t => t.id === id)` added to `makeEndedRegistry`; the `screen` not-live branch switched from `list().find(...)` to `get(m.id)`. Behavior-identical (`.find` → tombstone or `undefined`), no ring copy. Red→green unit test added; full lookup path still exercised by the existing not-live + e2e exited-line tests. |
| N3 | Resolved (A) | ✅ Confirmed closed | Comment above SPIKE 3 in `screen-render.test.js` marks it a permanent regression guard for the flush-before-read invariant under the `^6.0.0` caret range. The guard test itself is green (part of 44/44). |
| N4 | Resolved (A) | ✅ Confirmed closed | Comment at the `screen` handler states the confidentiality assumption explicitly (grid is raw-output-grade, no new boundary, rests on the per-boot secret gate whose Windows ACL is the pre-existing open P2 issue). Behavior-neutral; no new exposure surface introduced. |

### New findings (introduced by the remediation)

**N1. Mid-flush exit race touches the disposed buffer before discarding the result** — `server/board/screen-render.js:48`, `server/board/board.js:184-195` · confidence 75

On the already-initialized mid-flush leg of the W2 race — a `screen` read in flight when `p.onExit` disposes the line's emulator — `snapshot()` resumes after the flush and reads `term.buffer.active` on the now-disposed terminal *before* control returns to `read()`, which then discards the grid via the `disposed` post-await check. Reading `.buffer` on a disposed `@xterm/headless` terminal is not a no-op: it registers a fresh disposable onto an already-disposed store, which the library reports on stderr —

```
Error: Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!
    at get buffer (…/@xterm/headless/lib-headless/xterm-headless.js)
    at Object.snapshot (…/server/board/screen-render.js:48)
```

— and leaks that one disposable per race occurrence (reproduced directly against a real terminal, both interleavings). This does **not** corrupt the client reply (`read()` correctly returns `null` and the handler emits the exited-line reply), does not hang, and does not crash; the leaked disposable rides on a terminal being torn down and GC'd anyway. It is bounded (one per race hit) and the race window is narrow (a `screen` read landing in the exact event-loop turn a line is exiting). The fix's guard is placed *after* the disposed buffer read rather than *before* it; short-circuiting inside `snapshot()` (or having `read()` skip `snapshot()` when `disposed` flipped during the flush) would avoid touching the disposed terminal at all. NOTE, not blocking — the observable contract W2 targeted is met; this is an internal noise/leak artifact of the chosen post-hoc-discard approach.

### Notes on the sweep

- Full server suite green at the fix head: **249/249** (`node --test` over all `server/**/*.test.js`); board+screen-render focus **44/44**.
- `read()` rethrows only when `!disposed` (a genuine live-terminal snapshot error), matching the pre-fix `await s.screen.read()` behavior — not a regression introduced here.
- All 11 live validation-contract assertions remain delivered; VC-9 (exited → error with exit code) is now *more* robust under the exit race than at the reviewed head, which was W2's point.
