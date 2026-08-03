# Adopt libghostty-vt for VT emulation (server emulators + client renderer)

**Source:** User ask, 2026-07-23 — Ghostty advertises "cross-platform libghostty for embeddable terminals"; could agent-relay use it?
**Status:** 💡 Proposed — 2026-07-23. Deliberately parked: assessed feasible-in-principle, blocked on ecosystem maturity (see trigger signals).
**Kind:** Dependency swap / platform bet — replaces the xterm.js family at one or both ends of the terminal pipeline.
**Modules:** `server/board/board.js` + `server/board/screen-render.js` (the adr/0002 per-line screen emulator and the adr/0004 reconstructed replay, both `@xterm/headless` + SerializeAddon today); `client/src/core/TerminalView.tsx` + `client/package.json` (`@xterm/xterm`, fit/search/serialize addons). `node-pty` is untouched either way.
**Severity:** No current pain — this is an upgrade bet on VT conformance and native/WASM parse speed, not a fix.

## Motivation

libghostty-vt is the VT core extracted from Ghostty: escape-sequence parsing, terminal state, scrollback, reflow-on-resize, input encoding — proven for years inside the Ghostty GUI, now available standalone for Zig and C on macOS/Linux/Windows/WASM. Upstream it can format screen content back out as **plain text, VT sequences, or HTML** — the VT-sequences formatter is the SerializeAddon equivalent our replay path needs.

What it could buy agent-relay:

- **VT conformance.** Ghostty's emulation is best-in-class (kitty keyboard protocol, modern sequences). xterm.js is good but has quirks; agent TUIs (Claude Code, full-screen tools) are exactly the workloads that find them.
- **Parse speed.** Native/WASM parsing beats JS. Matters most for the server's per-line screen emulator and the per-attach replay reconstruction, which today spin up `@xterm/headless` instances in the board process.
- **Ecosystem momentum.** Coder maintains Node bindings and an xterm.js-compatible web build; the surrounding tooling (Restty, vscode-bootty, hauntty) suggests this becomes the standard embeddable VT core.

What it does **not** cover: PTY spawning (explicitly out of scope for libghostty — `node-pty` stays) and rendering (external concern — a web renderer must come from a wrapper like ghostty-web).

## Where it would slot in

Agent-relay has three terminal-shaped layers; libghostty-vt addresses the middle two:

| Layer | Today | libghostty path |
|---|---|---|
| PTY spawn/kill (board kernel) | `node-pty` | none — not covered, no change |
| Server VT state: rendered screen (adr/0002), replay reconstruction (adr/0004) | `@xterm/headless` + SerializeAddon | libghostty-vt via a Node binding (native or WASM-in-Node) |
| Client rendering | `@xterm/xterm` + fit/search/serialize addons | [ghostty-web](https://github.com/coder/ghostty-web) (xterm.js API-compatible, ~400KB WASM) |

## The structural constraint: matched emulators

Both ends are the **same emulator family** today, and that is load-bearing. The server serializes replay/screen state with xterm's own SerializeAddon; the client re-renders it with xterm.js — wrap, reflow, and SGR behavior match by construction. That symmetry is what adr/0004 leans on to kill the join scroll-garble.

Swapping only one end (ghostty server-side feeding xterm.js, or the reverse) reintroduces exactly the class of subtle cross-emulator mismatch the replay design exists to prevent. **If we switch, we switch both ends in one move** — server emulators and client renderer together — and re-verify the replay path (different-width join, mid-reconstruction live output ordering) end to end.

## State of the ecosystem (as assessed 2026-07-23)

- **Upstream [libghostty-vt](https://libghostty.tip.ghostty.org/)**: functionality stable (it *is* Ghostty's core), but the docs carry an explicit warning — API not yet stable, breaking changes expected. C and WASM targets; Windows supported at the C level.
- **[coder/libghostty-vt-node](https://github.com/coder/libghostty-vt-node)** (MIT, pre-release): Node-API bindings exposing `feed`/`resize`/`snapshot`/`getVisibleText` plus debug formatters. Two dealbreakers for us right now:
  - **No Windows prebuilds** — Linux x64/arm64 and macOS arm64 only; Windows explicitly unsupported for the initial package. This machine is the deployment target.
  - **No ANSI/VT-sequence serialization** — the one API the replay path needs. It exists upstream; the binding doesn't surface it. We'd be binding it ourselves against an unstable API, with a Zig toolchain in the build.
- **[coder/ghostty-web](https://github.com/coder/ghostty-web)** (MIT, v0.4.0): claims drop-in xterm.js API compatibility (`@xterm/xterm` → `ghostty-web`), ~400KB WASM, zero runtime deps. Built for Coder's Mux, not widely battle-tested; **addon compatibility unconfirmed** — we use FitAddon, addon-search, and `getSelection()` (copy path), and spectator mode's adopt-reported-dims + CSS-scale would need re-verification.
- **[Restty](https://github.com/Uzaaft/awesome-libghostty)**: alternative web terminal on libghostty-vt + WebGPU, also xterm.js-API-compatible. Younger; WebGPU raises the browser floor.

## Sketch of the migration (when triggered)

1. **Spike the client first** — ghostty-web behind the existing `TerminalView.tsx` seam (it already isolates xterm behind an imperative handle + `onStatusChange`). The client only consumes ANSI streams, so it can run against the unchanged server for the spike. Verify: fit-after-layout dance, search, selection/copy, theme sync (`xtermThemes.ts`), spectator scaling, reconnect reset-before-replay.
2. **Server second, in the same change** — replace the two `@xterm/headless` uses (per-line screen emulator in `board.js`, throwaway replay emulator in `screen-render.js`) with libghostty-vt via whatever binding is mature by then; the `screen` command's grid/cursor contract and `reconstructReplay`'s serialized-buffer contract stay identical so `sb screen`, the MCP `read_screen` tool, and the web client don't notice.
3. **Gate on the existing e2e seams** — `tombstone.e2e.test.js` pattern (isolated board via `AGENT_RELAY_PIPE`) extended with a replay-fidelity test: spawn a line, run a TUI-ish output script, join at a different width, assert the reconstructed screen.

## Risks / open questions

- **API churn.** Both upstream and the bindings warn of breaking changes; adopting now means chasing signatures. This is the primary reason to wait.
- **Windows build story.** Until the Node binding ships Windows prebuilds, we'd own a Zig cross-compile in `npm install` on the exact machine this runs on. WASM-in-Node sidesteps the toolchain but is unproven for the binding.
- **Serialization fidelity.** Even upstream's VT-sequence formatter needs verification against our replay contract (flat colored buffer, rewrap-clean at a different width). It was built for Ghostty's needs, not xterm SerializeAddon parity.
- **Addon surface on the client.** fit/search/serialize compatibility is claimed-adjacent, not documented. Losing search or selection is a UX regression, not a nicety.
- **Bundle cost.** ~400KB WASM added to the client; fine on desktop, worth a thought for the phone-over-tunnel path.
- **Two-ends-at-once scope.** The matched-emulator constraint makes this an L-sized single change, not two independent S changes. Budget accordingly.

## Trigger signals to prioritize

- **libghostty-vt declares API stability** (upstream removes the breaking-changes warning) — the gating event.
- **libghostty-vt-node ships Windows prebuilds + a VT-sequence serialization API** — the two concrete gaps; either appearing is worth a re-check of this doc.
- **ghostty-web documents addon compatibility** (or ships fit/search equivalents) at ≥ v1.
- **Real xterm.js pain**: a VT conformance bug garbling an agent TUI in a line, or per-line emulator memory/CPU cost at a fleet size that makes the board process sweat.

## Relationship to other issues

- **adr/0002 (board-owned rendered screen) + adr/0004 (reconstructed replay)** — the two designs whose *implementation* this swaps; their contracts (`screen` reply shape, replay-then-queued-live ordering) are the invariants any migration must preserve.
- **`2026-07-02-scrollback-persistence.md`** — a persisted-transcript format chosen before this lands should stay emulator-neutral (raw byte-log, not serialized emulator state), so the two don't couple.
