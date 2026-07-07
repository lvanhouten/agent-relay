# 01 — Shell selection core

## Agent Brief

**Category:** enhancement
**Summary:** Pure shell-selection module: decide `mobile` vs `desktop` from window geometry + an optional per-window override, with injected-storage override helpers.

**Current behavior:**
The client has exactly one UI (the phone-shaped screen stack); nothing anywhere decides between shells. There is no notion of a shell override.

**Desired behavior:**
A new pure module in the client's extracted TypeScript core (where debugged, non-obvious logic lives per repo convention, unit-tested via `node --test` type-stripping) that answers "which shell should this window get?" with zero DOM access:

- A window is **phone-shaped** (glossary term) iff it is portrait (height > width) **or** narrower than 768 CSS px. Phone-shaped → `mobile`, otherwise `desktop`.
- A stored override, when present and valid, beats the heuristic in both directions.
- Storage is **injected** (anything with `getItem`/`setItem`/`removeItem`), never touched globally — the caller passes `window.sessionStorage` in production. `sessionStorage` (per-window) is a load-bearing decision per the PRD: the override must never leak across windows, or a desk-side "force desktop" would hijack the phone-over-RDP window.
- Garbage in storage (unknown string, storage throwing) reads as "no override" — never an exception, never a truthy misread.

**Key interfaces:**

- `ShellKind` — `'mobile' | 'desktop'` (exported type; briefs 05 consumes it).
- `decideShell({ width, height, override }: { width: number; height: number; override: ShellKind | null }): ShellKind` — pure decision: override wins when non-null; else the phone-shaped heuristic.
- `readShellOverride(storage): ShellKind | null` — returns null on missing key, unrecognized value, or a storage that throws.
- `writeShellOverride(storage, kind: ShellKind | null): void` — null clears the override; swallows storage exceptions (private-mode quota etc. must not crash the toggle).

**Acceptance criteria:**

- [ ] Decision matrix fully tested: landscape-wide → desktop; portrait (any width, including wider-than-768 portrait) → mobile; landscape narrower than 768 → mobile; exactly 768 landscape → desktop; each of those inverted by an explicit override in both directions.
- [ ] `readShellOverride` returns null for absent key, junk value, and a throwing storage; `writeShellOverride(storage, null)` removes the stored value; a throwing storage does not propagate.
- [ ] All tests pass via the client workspace's test script, and each new guard is proven by mutation (break the invariant, watch the test fail, revert) per repo convention.
- [ ] Client typecheck stays green.

**Out of scope:**

- Any DOM/window measurement or React wiring (brief 05 owns calling this at boot).
- The toggle UI, and any UI at all.
- `localStorage` in any role.
- Live re-evaluation on resize (the decision is boot-time by design).

**Depends on:** none

**Covers:** VC-4, VC-5

**Runtime:** parallel-safe
