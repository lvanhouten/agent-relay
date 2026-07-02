# Initial run-command feed has no delivery confirmation and stacks redundant timers

**Source:** Came up auditing the board's initial-command ("run" field) keystroke feed. The feed injects the command once the shell first emits output, but never verifies the shell actually accepted it, and it schedules a fresh debounce timer on every output burst during startup.
**Status:** ⏸ Deferred — 2026-07-01.
**Kind:** Tech-debt
**Modules:** board
**Severity:** Low

## What's already been closed

The timing constants were named (`FEED_DEBOUNCE_MS` / `FEED_FALLBACK_MS`) and the log line no longer prints the command text — but the reliability concern below is untouched.

## What remains

In `server/board/board.js` `createLine`, the `run` feed does two things worth revisiting:
1. **No delivery confirmation.** `feed()` writes `run + '\r'` once (guarded by `sent`) and assumes it landed. A slow-starting shell whose input reader isn't ready when the fallback timer fires can silently eat the injected command, with no retry and no surfaced error — the line just sits at a prompt having run nothing.
2. **Redundant timers.** `p.onData(() => setTimeout(feed, FEED_DEBOUNCE_MS))` schedules a new timer on every output burst during startup. It's harmless (the `sent` guard makes all but one a no-op) but wasteful on a chatty startup.

## Fix outline

- For (2): keep a single debounce timer and `clearTimeout` it on each burst rather than stacking new ones. (small)
- For (1): the hard part — confirming a keystroke feed actually took requires reading the line back for an echo of the command (fragile across shells/echo settings) or a retry-until-observed loop with a cap. This needs a design decision on how much reliability is worth versus keeping the feed simple. (medium; needs judgment)
- Cross-cutting risk: a retry that misfires could double-run the command. Any retry must be idempotent-safe or observe an echo before re-sending.

## Trigger signals to reopen

- A user reports a session's initial command silently not running (empty prompt where the command should have executed).
- Support for a shell with notably slow input-reader startup is added.
- Profiling ever flags timer churn on line creation (unlikely at this tool's scale).

## Repro

The confirmation gap is timing-dependent and hard to reproduce on demand: it manifests when a shell's first output arrives before its input reader is ready and the fallback timer fires into a not-yet-listening shell. The redundant-timer behavior is observable by counting `setTimeout` calls during a bursty shell startup.
