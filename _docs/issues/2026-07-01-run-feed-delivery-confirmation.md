# Initial run-command feed has no delivery confirmation and stacks redundant timers

**Source:** Came up auditing the board's initial-command ("run" field) keystroke feed. The feed injects the command once the shell first emits output, but never verifies the shell actually accepted it, and it schedules a fresh debounce timer on every output burst during startup.
**Status:** ✅ Resolved — 2026-07-02 (single debounce timer + confirm-and-retry feeder).
**Kind:** Tech-debt
**Modules:** board
**Severity:** Low

## Resolution — `makeRunFeeder` state machine

The inline feed in `createLine` was replaced with `makeRunFeeder(run, io)` (in `board.js`), a small state machine with its clock/timer/write/liveness injected so the logic is unit-testable without a pty. It fixes both points:

1. **Redundant timers** — the pre-send debounce is now a single timer, cancelled and rescheduled on each startup output burst, instead of a fresh `setTimeout` per burst.
2. **Delivery confirmation** — after a send, the feeder watches for *any* output the shell produces in reaction (a command typed at a live prompt echoes before it even runs). Output after a send → delivered, stop. Total silence for `FEED_CONFIRM_MS` (500) → the keystrokes were almost certainly dropped → re-send, capped at `FEED_MAX_SENDS` (2). `FEED_FALLBACK_MS` remains the backstop for a shell that's silent on start.

**Double-run safety** (the cross-cutting hazard flagged in the original): a re-send happens *only* on total post-send silence. The lone false-positive direction — continued prompt output mistaken for a reaction — leans toward "assume delivered" (skip the retry), never toward re-sending. The residual double-run risk is a fresh prompt with echo OFF running a command that emits nothing, which is rare and bounded to one extra send. This is text-agnostic on purpose (it does not try to match the echoed command), so it isn't fooled by PSReadLine syntax-highlight escapes.

Verified: 6 unit tests over a fake clock (`board.test.js`) cover debounce reuse, one-retry-on-silence, the send cap, settle-on-reaction, the silent-shell fallback, and the dead-line guard. A live e2e against a real pwsh line (initial command `Write-Output (111*111)`, whose output `12321` never appears in the command text) confirmed the command executed **exactly once** — delivered, no double-run. 61 server tests pass.

## Original finding (retained)

The timing constants were named (`FEED_DEBOUNCE_MS` / `FEED_FALLBACK_MS`) and the log line no longer prints the command text — but the reliability concern below was untouched at deferral time.

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
