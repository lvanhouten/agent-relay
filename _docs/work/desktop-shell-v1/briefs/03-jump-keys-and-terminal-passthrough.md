# 03 — Jump-key predicate + terminal passthrough

## Agent Brief

**Category:** enhancement
**Summary:** One pure predicate recognizing the Alt+1..9 session-jump chord, plus an optional `passthroughKeys` prop on the terminal view so the chord escapes a focused xterm instead of being swallowed.

**Current behavior:**
The terminal view (the core's xterm wrapper) consumes keyboard input wholesale while focused — it already has custom key handling (Ctrl+D detach, find-toggle). There is no session-jump chord anywhere, and no way for an embedding shell to reclaim specific keys from a focused terminal.

**Desired behavior:**
Two coordinated pieces, one definition of "a jump chord":

- A pure predicate in the client's TypeScript core mapping a keyboard event to a jump index. Alt + a digit key `1`–`9`, with no other modifiers (no Ctrl/Meta/Shift) and not a key-repeat, yields that digit as a number. Everything else — bare digits, Ctrl+digit (browser-reserved anyway), Alt+`0`, Alt+letter, Alt+Shift+digit, repeats — yields null. Digit recognition must work across keyboard layouts where feasible (prefer `event.code`'s `Digit1`..`Digit9` over `event.key`, so Alt-modified layouts can't remap it away); pin whichever signal is chosen in a comment and test it.
- The terminal view gains an optional `passthroughKeys?: (e: KeyboardEvent) => boolean` prop, wired into its existing xterm custom key-event handling: when the prop returns true for a keydown, xterm must not consume the event and it must continue propagating so a document-level listener (the workspace shell's, in brief 05) receives it. When the prop is absent, behavior is byte-for-byte today's. Existing custom handling (Ctrl+D detach, find toggle) is unaffected.

The one predicate is exported for both consumers — the workspace's global listener and the terminal's passthrough — so the two can never disagree about what a jump chord is.

**Key interfaces:**

- `jumpIndexFromKey(e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key' | 'repeat'>): number | null` (exported; brief 05 consumes it — the workspace passes `(e) => jumpIndexFromKey(e) !== null` as the terminal's passthrough).
- `TerminalView` props — gains optional `passthroughKeys`; no signature change to anything else on the component or its imperative handle.

**Acceptance criteria:**

- [ ] Predicate matrix fully tested: Alt+1 → 1 and Alt+9 → 9; Alt+0, Alt+letter, bare digit, Ctrl+digit, Ctrl+Alt+digit, Alt+Shift+digit, and a repeat event → null.
- [ ] With `passthroughKeys` provided, a matching keydown inside a focused terminal is not written to the PTY and reaches a document-level keydown listener (named guarded code path in the terminal view; the end-to-end proof rides brief 05's browser verification).
- [ ] With `passthroughKeys` absent, the terminal's key handling is unchanged — existing client tests and typecheck stay green.
- [ ] Each new test proven by mutation per repo convention.

**Out of scope:**

- The document-level listener itself, sidebar-order mapping of index → session, and any selection behavior (brief 05).
- Rebinding or changing existing terminal chords (Ctrl+D, find toggle).
- A configurable/keybinding system — the chord is fixed.

**Depends on:** none

**Covers:** VC-10

**Runtime:** parallel-safe
