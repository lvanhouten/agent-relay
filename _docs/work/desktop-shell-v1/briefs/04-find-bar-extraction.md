# 04 — Find bar extraction

## Agent Brief

**Category:** enhancement
**Summary:** Extract the terminal find bar out of the mobile terminal screen into a shared chrome component both shells can import, with zero behavior change on mobile.

**Current behavior:**
The find bar — text input, IME-composition guard (Enter during composition must not run the search), Enter/Shift+Enter next/prev, Escape-to-close, match-count readout, prev/next/close buttons — is inlined in the mobile terminal screen's JSX, driving the terminal view's imperative handle (`searchNext`/`searchPrev`/`clearSearch`) with results arriving via the view's search-results callback. The readout formatting already lives in a tested core module.

**Desired behavior:**
The same bar as a standalone shared component (the one deliberately shared piece of chrome per the PRD — everything else stays per-shell), so the desktop workspace (brief 05) imports it instead of duplicating debugged behavior:

- The component owns its input state, autofocus-on-mount, and all keyboard handling including the IME guard, exactly as today.
- It communicates outward only through callbacks + a results prop — it never touches the terminal view directly, so each shell wires it to its own view ref.
- The mobile terminal screen re-imports it; every observable mobile find behavior is identical (open, type-as-you-search, Enter/Shift+Enter, Escape, readout, buttons, close-clears-search).

**Key interfaces:**

- `FindBar` component (exported shared chrome; brief 05 consumes it) with props:
  - `results: SearchResults` (the existing core type),
  - `onQuery(term: string): void` — fired as the term changes (empty term = caller clears),
  - `onNext(term: string): void`, `onPrev(term: string): void`,
  - `onClose(): void`.
- The mobile screen keeps owning *when* the bar shows and what the callbacks do (its current open/close/clear logic), so the component stays presentation + input handling only.

**Acceptance criteria:**

- [ ] Mobile find-in-output flow verified unchanged in a real browser: open the bar, type to search with live readout, Enter / Shift+Enter cycle matches, Escape closes and clears highlights.
- [ ] The IME guard survives the move as a named guarded code path (Enter during composition does not trigger search).
- [ ] No changes to core search/readout modules; existing client tests and typecheck stay green.
- [ ] The component contains no shell-specific styling assumptions that would block reuse in the desktop toolbar (tokens only).

**Out of scope:**

- The desktop toolbar and any desktop usage (brief 05).
- Extracting any other chrome (header, composer, footer — deliberately per-shell).
- New find features (regex, case toggle, etc.).

**Depends on:** none

**Covers:** VC-2, VC-15

**Runtime:** parallel-safe
