# The attach replay is reconstructed at the PTY's pre-attach width, so a joiner at a different size gets history laid out for the old grid

**Source:** Fell out of fixing the "Claude Code TUI is janky until you resize the window" bug (2026-07-30). That symptom was a dropped WS frame — `server/src/ws.js` registered `ws.on('message')` after two board RPCs, so the client's open-time `resize` was emitted with no listener and lost, leaving the PTY at its pre-attach size. With the frame no longer dropped, the live screen now corrects itself on the resulting SIGWINCH; what stayed wrong is the history written *before* that resize.
**Status:** ⏸ Deferred — 2026-07-30. Blocked on a deliberate board restart, not on a decision (see *Why this isn't a drop-in patch*).

<!-- Status lifecycle — update the icon + label (and date) as the issue moves. New docs start ⏸ Deferred:
     ⏸ Deferred  — parked; waiting on a trigger signal below to fire.
     🔴 Reopened  — a trigger signal fired; back in the active queue (note what fired it + the date).
     ✅ Resolved  — fixed; record the commit/PR and the date.
     ✋ Won't fix  — decided not to address; record the reason and the date. -->
**Kind:** Correctness gap in the board's attach protocol (a joiner cannot declare its size *as part of* attaching)
**Modules:** `server/board/board.js` (`attachWithReplay`), `server/board/screen-render.js` (`reconstructReplay`), `server/board/lib.js` (the data-pipe handshake), `server/board/patch.js` (`sb join`), `server/src/board-client.js` (the web joiner)
**Severity:** Low — self-limiting and cosmetic: it touches only the pre-attach scrollback of a line whose app lays out its own rows, never the live screen, input, or exit handling. Rises to Medium if the phone path becomes routine, since a narrow joiner sees every box and rule that a wide desktop drew mis-wrapped for the whole session's history.

## What's already been closed

The frame-drop half is fixed and verified end to end. `ws.js` now registers `message` and `close` in the connection handler's first synchronous block and buffers pre-attach frames (capped, since the queue opens before the credential gate), draining them in arrival order once the handle exists; `board-client.js` no longer swallows a failed control connect, which had silently disabled resize for an entire attach. Measured on a fresh line: an open-time `resize 147x44` moved the PTY from 120x30 at +69ms where it previously never applied at all. Three tests in `ws.test.js` guard it, mutation-proven against both the missing buffer and the wrong registration point — and they replaced two older tests that had *documented* the race as expected ("the message listener registers only after the async attach, so a single send would race it").

So the reported symptom — a TUI that needs a manual window resize before it renders right — is gone. What follows is the residual.

## What remains

`attachWithReplay` (`board.js`) snapshots the replay width synchronously, before its first await:

```js
const chunks = s.buf.slice();
const cols = s.pty.cols, rows = s.pty.rows;
```

That is deliberate and its comment says why: "this join's own resize arrives later on a separate pipe — so the pre-join width is still the width the buffered bytes were captured at." The snapshot is correct *for the bytes already captured*. The gap is that it is also the width the replay is **rendered at**, and no joiner can tell the board its size until after it has already attached. The ordering is fixed by the protocol:

1. joiner connects the data pipe → board reconstructs + writes the replay at the PTY's current width;
2. joiner's `resize` arrives afterwards (web: over the control socket once the WS handle exists; `sb join`: `patch.js` calls `sendResize()` at line 64, *after* `connectPipe` at line 43 — identical exposure);
3. PTY resizes → SIGWINCH → the app repaints its live region at the new width, correctly.

Step 3 is why this is only a residual: everything the app redraws is fine. But the replay from step 1 is already on the joiner's screen. `SerializeAddon` preserves soft-wrapped rows as logical lines, so ordinary flowing text re-wraps clean at the joiner's width — that is exactly the adr/0004 win and it still holds. What does not heal is layout the *app itself* committed with hard newlines sized to the old grid: a TUI's box borders, horizontal rules, padded columns. Claude Code's message boxes and `───` rules are precisely this. They stay at the old width for the life of the scrollback, in a terminal that is now a different width.

Worth noting the clamp interacts: `applyMin` keeps the PTY at the *smallest* patched pane, so with a second smaller pane attached the joiner's own width is not what it gets anyway. Any fix has to reconstruct at the width the PTY will actually be after the clamp, not at the width the joiner asked for.

## Why this isn't a drop-in patch

Every option below changes `board.js` and/or `lib.js`, which are loaded by the **long-lived daemon**. Deploying means restarting the board, and that ends every line it owns — including live agent sessions. So this ships at a deliberate break, never opportunistically. Build and prove it against an isolated board first (`AGENT_RELAY_PIPE`, with `server/board/tombstone.e2e.test.js` as the template); every RPC in that test's teardown must go through the same namespaced env or it will shut down the production board.

## Fix outline

- **Preferred — let attach carry the joiner's dims.** Extend the data-pipe handshake's first line (today `<secret>\n`) to accept optional dimensions, so `attachWithReplay` can register the pane's size, apply the clamp, and reconstruct at the *resulting* width in one atomic step. No cross-pipe ordering to reason about, no ack needed, and it fixes `sb join` and the web client by construction. Must stay backward compatible: a bare secret line keeps today's behavior. (medium)
  - **Decision it forces:** the clamp is keyed by *control* socket today (`s.sizes`, freed on that socket's close). Handshake dims arrive on the *data* socket, so either the clamp migrates to being keyed per-attach — arguably more correct, since a pane's size should live exactly as long as the pane — or the handshake value is a pre-registration that the control socket later replaces, which means two writers to one map. Pick one before writing code; the first is cleaner but touches `sb join`, `--here`, and spectator-mode clamp entry/exit (`setSpectator` opens/closes the control socket precisely to leave and re-enter the clamp).
- **Cheap partial, no board change — reorder the two joiners.** Move `patch.js`'s `sendResize()` above its `connectPipe`, and resize before attaching in `board-client.js`. Both then usually win the race, since the board is single-threaded and the `resize` case is synchronous. But it is a race, not an ordering guarantee: `resize` has no reply to await (see the pipelining note at `board.js:653`), and the data-pipe handshake needs a round trip while the control write is already queued. Cheap and strictly better than today; not a design. (small)
- **Give `resize` a reply** so a joiner can await it and do resize-then-connect deterministically. Removes the race from the option above but adds the first reply-producing command on a persistent socket, which the same `board.js:653` note calls out as needing sequential awaiting or a per-socket queue. Only worth it if the preferred option is rejected. (medium)
- **Don't bother re-rendering old history.** Explicitly out of scope: re-serializing the replay after the resize would mean re-writing the joiner's whole screen, which is a flash and, on a reconnect, risks the double-replay corruption `TerminalView`'s mount-once invariant exists to prevent.

## Risks / open questions

- **Clamp bookkeeping is the real surface area**, not the replay. Getting a size registered from two places (or keyed to the wrong lifetime) can pin a line small after a pane leaves, which is worse than mis-wrapped history — a wedged narrow PTY affects every attached client.
- **Back-compat across the board boundary.** A restarted board may still be joined by an older `sb`/`patch` from a shell that hasn't been restarted, so the bare-secret path must keep working.
- **Verification needs a real TUI.** A flat-text fixture will pass either way, because flowing text already re-wraps correctly — the assertion has to be against content with app-emitted hard newlines at the capture width (a box or rule), joined at a different width.
- **Spectator panes must stay out of it.** They deliberately own no control socket and never resize the shared line; a handshake that declares dims must not accidentally enrol them in the clamp.

## Trigger signals to reopen

- History visibly boxed or ruled at the wrong width after joining from the phone a line the desktop last sized (or the reverse). This is the likeliest real-world hit, given the phone/desktop split.
- `sb join` from a pane whose size differs from the line's current width shows the same artifact in its scrollback — the CLI half of the identical bug.
- **`2026-07-02-scrollback-persistence.md` is picked up.** It has to decide what width a persisted transcript is stored at; deciding that without this fix bakes the wrong answer in. Do them together, and keep the stored format emulator-neutral (raw byte-log, not serialized emulator state).
- **`2026-07-23-libghostty-vt-adoption.md` is triggered.** That swaps `reconstructReplay` wholesale, so fold this in rather than fixing it twice — its migration sketch already calls for a replay-fidelity test at a different join width, which is exactly the missing coverage here.
- A new joiner type is added (another pane kind, a recording/transcript reader), making the "declare your size when you attach" gap structural rather than incidental.

## Repro

1. Start a line running a TUI that draws its own boxes (`claude`), and drive the PTY to a wide grid — attach from a wide window, or force it: open a control socket and send `{cmd:'resize', id, cols:150, rows:40}`.
2. Generate history with app-drawn layout: send a couple of prompts so several bordered message boxes and `───` rules scroll into the scrollback.
3. Detach every client. The PTY keeps its last size (`applyMin` returns early with no panes registered).
4. Re-attach from a much narrower client — a phone, or a browser window at ~800px.
5. The live input box and status line render correctly at the new width (the post-attach resize + SIGWINCH did their job), but the history above is still laid out for the 150-column grid: rules run past the viewport or hard-wrap mid-border, boxes break. Nothing repairs it — the app never redraws that region.

Contrast: repeat with a plain shell printing long flowing text instead of a TUI. That history re-wraps cleanly at the new width, confirming the defect is specifically app-emitted hard newlines at the capture width, not the replay path in general.

## Relationship to other issues

- **adr/0004 (reconstructed attach replay)** — this does not contradict it. Feeding the log through an emulator and serializing is what makes flowing text re-wrap clean; the gap is only *which* width that emulator is sized to, which the current protocol cannot know until after the replay is already written.
- **adr/0002 (board-owned rendered screen)** — unaffected: `screen` reads the live grid at the PTY's real dims and is re-read on demand, so it has no stale-width equivalent.
- **`2026-07-02-scrollback-persistence.md`** and **`2026-07-23-libghostty-vt-adoption.md`** — both rework this path; see the trigger signals above.
