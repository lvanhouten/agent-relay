# In-app notifications (toasts) — surface errors and lifecycle events inside the window

**Source:** User ask, 2026-07-21 — "notifications that pop up inside of the app window, especially for when errors happen, or when a session is closed." Open to other notification types.
**Status:** 🟡 Error slice landed — 2026-07-21. The `Toast` primitive, the pure `toastQueue` reducer, the `useToast` provider/host (both shells), and the three genuinely-silent error events (sticky relay-unreachable, failed kill, failed create) shipped. **Still open:** the session-lifecycle slice (exit/crash toasts from the poll diff) and the cross-surface attention slice (the `notifyTransitions` two-sink refactor). WS attach-refused was deliberately left out of the error slice — the per-terminal `ConnStatus` dot already surfaces it for the viewed terminal, and the "session you're *not* viewing" case is attention-slice work.

### What landed (error slice)
- `_docs/design-system/components/core/Toast.jsx` — new DS primitive (runtime-injected `<style>` singleton, `error`/`warn`/`success`/`info` accent bar, self-owned auto-dismiss timer paused on hover/focus, `duration={0}` = sticky, optional action button, `role=alert` for errors). Not yet added to the generated `_ds_bundle.js` / `_ds_manifest.json` — left for their generator.
- `client/src/core/toastQueue.ts` (+ `.test.ts`) — pure enqueue/coalesce-by-key/cap/dismiss reducer. No time, no id gen (provider owns those). Sticky toasts survive the visible cap; dismiss is identity-preserving on a miss so the 5s poll's `dismissKey` doesn't churn the host.
- `client/src/core/useToast.tsx` — `ToastProvider` + `useToast()`; exposes a stable `notifier` so `useSessions` can list it in effect deps without re-subscribing the poll.
- `client/src/chrome/ToastHost.jsx` + `.module.scss` — the host, `placement='corner'` (desktop) / `'bottom'` (mobile), `z-index:60` (over the create dialog).
- Wiring: `App.jsx` wraps both shells in `ToastProvider` + mounts the host; `useSessions` surfaces the sticky relay-unreachable (coalesced, self-clearing on the next good poll) and the previously-silent failed kill; both shells toast a failed create alongside the inline dialog text.

_Original proposal below._
**Kind:** Enhancement (client UX) + a new design-system component.
**Modules:** client (a new notification host mounted by both shells; a shared `core/` reducer), design-system (`Toast`/`Snackbar` core component — none exists today). No server change for the initial cut.
**Severity:** Medium. Today several failures are *silent* (a dropped poll, a failed kill), which is worse than noisy — the operator has no idea the UI is lying to them.

## Motivation

The relay already has three notification channels, and this is a fourth that none of them cover:

| Channel | Where | Fires when | Covers |
|---|---|---|---|
| OS desktop notification (`useDesktopNotifications` + `notifyRules`/`notifyGate`) | Desktop shell only | window **un**focused | needs-input transitions only |
| Pushover push | phone | Claude Code hook fires | needs-input, turn-done |
| Attention `StatusDot` / card badge | in-app, passive | continuously | running / idle / needs-input / exited |
| **This doc — in-app toast** | in-app, **active + transient** | while you're *using* the app | **errors, session lifecycle, cross-surface attention** |

The hole is the **focused-window, active-but-transient** quadrant. The OS-notification reducer deliberately bails when the window is focused (`notifyTransitions` returns `[]` if `windowFocused`) on the theory that "the pulsing dot already carries the signal." That's true for a *persistent* state like needs-input, but it's the wrong call for two classes of event:

1. **Errors have no persistent indicator at all.** They happen once and vanish. Today they're handled inconsistently and mostly invisibly:
   - **Dropped poll** (`useSessions.load` → `catch { /* offline — keep stale list */ }`) — the list silently goes stale. The operator is looking at a lie with zero signal that the relay is unreachable.
   - **Failed kill** (`useSessions.kill`) — the `catch` is a bare `finally`; nothing surfaces. The session optimistically disappears, then flickers back on the reconcile poll with no explanation.
   - **Failed create** — surfaced, but *only* as inline text inside `NewSessionDialog` (`createError`). If the dialog is closed or the error is transient, it's gone.
   - **Board-unreachable 503 / WS 1008 / WS disconnect** — only the per-terminal `ConnStatus` dot moves, and only if you're looking at that terminal.
2. **Lifecycle events are point-in-time.** A session *exiting* (especially a non-zero crash) leaves a tombstone in the "Recently exited" list, but nothing actively tells you it happened while you were looking at a different session. "A session is closed" (the user's explicit example) is exactly this.

So: a lightweight, transient toast surface that any part of the client can push into, for the events that are *momentary* and would otherwise be missed by a passive indicator.

## Proposal outline

### The surface — a `Toast` core component + a host

- **New design-system component** (`_docs/design-system/components/core/Toast.jsx`) — there is no toast/snackbar/alert primitive today. Same runtime-injected `<style>` singleton pattern as the other core components (so it stays portable to `_ds_bundle.js`); severity variants (`error` / `warn` / `success` / `info`) keyed off tokens; auto-dismiss with a timer, hover-to-persist, manual dismiss, and an optional action button.
- **A notification host** — a small provider + queue mounted once per shell (both `MobileShell` and `DesktopWorkspace`). Toasts stack (bottom on mobile, a corner on desktop), coalesce by a dedup key, and cap the visible count. This is app-owned UI, so it's **SCSS Modules** (ADR-0006), consuming the design-system `Toast`.
- **An imperative `notify()` seam** — a context hook (`useToast()`) so any surface can push one: `useSessions` on a poll/kill failure, the WS layer on disconnect, the exit-frame handler on a crash. Pure enqueue/coalesce/expire logic goes in a unit-tested `core/toastQueue.ts` (mirrors how `scrollPill.ts` / `notifyGate.ts` keep the reducer pure and the hook thin).

### The event taxonomy (what actually fires one)

**Errors (the primary ask):**
- Poll/list failure → **the relay is unreachable** — a *sticky* toast (not auto-dismiss) that clears itself on the next successful poll. This is the most valuable one: it converts a silent lie into a visible "reconnecting…" state.
- Create failure → toast in addition to (or instead of) the inline dialog text, so it survives the dialog closing.
- Kill failure → toast (today: completely silent).
- WS attach refused (1008 / board-unreachable) and unexpected disconnect of a session you're *not* currently viewing.

**Session lifecycle (the user's second example):**
- Session **exited** — fire on the poll diff that first sees `status: 'exited'`. Distinguish `killed` (you did it — quiet/`info`, maybe suppress if you initiated it) from `exited` with a non-zero code (a **crash** — `error`, clickable to jump to its tombstone/scrollback). The board already carries `reason` + `exitCode` in the tombstone.

**Cross-surface attention (the focused-window counterpart to the OS notification):**
- A session enters **needs-input** while the window is focused *but* you're looking at a different session — an in-app toast with a "jump to it" action. This is the exact transition `notifyRules.notifyTransitions` already computes; today it's dropped when focused. Reuse that reducer as the single source of truth and route it to **two sinks**: OS notification when unfocused (as now), in-app toast when focused. One detector, two delivery surfaces.

**Optional / later:**
- Turn-done for a background session (mirrors the Pushover turn-done, in-app).
- A `success` confirmation on create ("`<name>` started") — low value, include only if it doesn't add noise.

### Why a poll-diff reducer, not scattered call sites, for lifecycle events

Lifecycle toasts (exit, needs-input) should be **derived from the same consecutive-poll diff** that drives `notifyRules`, not fired ad-hoc, so they inherit its hard-won invariants: transition-based (fire on *entering* a state, never for staying in it), no burst-notify on first poll after load/reconnect (`before === undefined` guard), and dedup by session id. Errors, by contrast, are genuinely imperative (a `catch` block) and push directly via `useToast()`.

## Risks / open questions

- **Noise budget.** A fourth channel that over-fires gets ignored like any other. Bias conservative: coalesce duplicates hard (one "relay unreachable" toast, not one per 5s poll), suppress lifecycle toasts for actions the operator just initiated (you killed it — you know), and keep auto-dismiss short for `info`/`success`.
- **Sticky vs. transient.** The "relay unreachable" toast must be *sticky and self-clearing* (persist until the next good poll), unlike everything else which auto-dismisses. The queue needs to model both — a plain "expire after N seconds" isn't enough.
- **Overlap with the persistent indicators.** Don't double-signal: needs-input already has a pulsing dot. The toast is justified only because it's *momentary + cross-surface* (you're focused on session A, session B needs input). Fire it once on transition; the dot carries the ongoing state.
- **Interaction with the OS-notification reducer.** The cleanest shape is to unify: `notifyTransitions` becomes the shared detector and the focus check moves *out* of it into the two sinks (unfocused → OS, focused → toast). That's a refactor of a well-tested pure module — do it deliberately, keep its tests green, and don't let the toast path resurrect the first-poll burst it already guards against.
- **Both shells or one?** Errors and lifecycle matter on mobile too (a failed create on a phone is just as silent). Mobile stacking is tighter on space — bottom-anchored, one at a time. Ship the host to both; the OS-notification hook stayed desktop-only for a permission reason that doesn't apply here (no OS permission needed for an in-window toast).
- **Payload safety.** Session names flow into toast text; reuse `notifyName()` (the control/bidi-strip + length cap already in `notifyRules.ts`) rather than interpolating raw names.
- **No server change needed** for the initial cut — every event is already observable client-side (poll diffs, fetch rejections, WS frames). Resist scope-creeping a server push channel in here.

## Trigger signals to prioritize

- The first time a silent failure actually bites — you act on a stale session list because a dropped poll gave no signal, or a kill silently failed and you assumed it worked. This is the strongest driver and argues for doing the **error** slice first, ahead of the lifecycle/attention slices.
- A background session crashes (non-zero exit) and you don't notice until much later because you were in another session.
- Building anything that needs transient user feedback (spawn-templates confirmations, broadcast-input results) — that's the moment the missing `Toast` primitive becomes a recurring gap, not a one-off.

## Relationship to other issues

- **`2026-07-02-hook-driven-push-notifications.md`** — the phone-push counterpart. This is the in-window sibling; they cover disjoint moments (you're at the machine vs. away). The event taxonomy overlaps (needs-input, turn-done) but the delivery and the noise budget differ.
- **`2026-07-15-agent-judged-notifications.md`** — same "don't cry wolf" principle. If turn-done ever becomes an in-app toast, it should inherit the judged-not-unconditional stance from that doc rather than firing on every turn-end.
- **`2026-07-07-desktop-fleet-extras.md`** — broadcast input (a landed-adjacent v3 item) is a natural first *non-error* consumer of the `Toast` primitive (per-session send results). Build the primitive here; that feature calls it.
- **`notifyRules.ts` / `notifyGate.ts` / `useDesktopNotifications.ts`** — the existing OS-notification stack is the direct precedent and the intended shared detector. This doc's cleanest implementation refactors that reducer to feed both sinks rather than duplicating the transition logic.
