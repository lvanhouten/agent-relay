# Inline-only styling can't express hover/focus/media — every screen re-solves the same gap in JS

**Status:** ✅ Closed — 2026-07-11. Resolved by **[ADR-0006](../adr/0006-scss-modules-for-app-owned-styling.md)** + the `scss-modules-migration` branch. App-owned UI (`screens/`, `chrome/`, `desktop/`, `App`, `TerminalView`) migrated to colocated `.module.scss`; `client/src` now has **zero** static inline `style={{}}` (the sole remaining `style` prop, TerminalView's terminal background, was also eliminated via `var(--terminal-bg)`). The `@ds` kit deliberately kept its injected-`<style>` pattern — it was never inline styling and powers the zero-build preview bundle (ADR §4). The terminal-header breakpoint that prompted this doc is now a `@media` rule in `TerminalScreen.module.scss`; `core/useMediaQuery.ts` was deleted as orphaned. **Correction:** this doc's premise that the `@ds` components hand-rolled hover with `onMouseEnter`/`onMouseLeave` was stale — grep found zero such handlers; those components were already class-based CSS. See the ADR for the full decision and rejected alternatives.

**Source:** Came up fixing the terminal header's long-title overflow (2026-07-09) — the fix needed a viewport-conditional max-width, and inline React styles have no `@media`, so it took a bespoke `useMediaQuery` hook (`client/src/core/useMediaQuery.ts`) to get live-updating breakpoint behavior at all. `desktop-shell-v1`'s scoping pass flagged the same wall independently ("inline styles + tokens can't express hover/focus-visible") and deferred it to that build's grill; this doc pulls the decision out on its own so it can be picked up (or formally deferred) without waiting on the desktop shell.
**Status:** ✅ Closed — 2026-07-11 (was: 💡 Proposed — 2026-07-09). See the closure note at the top.
**Kind:** Tech-debt (architectural)
**Modules:** client — every screen (`SessionsScreen.jsx`, `TerminalScreen.jsx`, `LoginScreen.jsx`) and the design system (`_docs/design-system/components/core/*.jsx`, `_docs/design-system/tokens/*.css`)
**Severity:** Medium — nothing is broken today, but the cost compounds: each new responsive or interactive-state requirement gets its own one-off JS workaround instead of a CSS rule.

## Motivation

`client/src` has zero `className` usage — every component is inline `style={{...}}` objects, per the design system's deliberate "plain React + inline styles, no CSS framework" convention. That convention has a real, growing cost:

- **No `@media`.** Inline styles can't express breakpoints at all. The composer default (`prefersComposer`, `TerminalScreen.jsx`) reads `matchMedia('(pointer: coarse)')` once at mount; the header title-width fix just shipped needed a *second*, live-updating `matchMedia` hook to react to resize. Every future responsive value is another hand-rolled hook.
- **No `:hover`/`:focus-visible`.** Four design-system core components already hand-roll hover state with `onMouseEnter`/`onMouseLeave` JS handlers (`Button.jsx`, `IconButton.jsx`, `Card.jsx`, `OverflowMenu.jsx`) — extra state, extra re-renders, and a `:focus-visible` story (keyboard-only focus rings) that plain inline styles cannot do at all without yet more JS.
- **No `@keyframes` at the component layer.** The pulsing `attention` `StatusDot` and similar animated states either fall back to global CSS (already true — `main.jsx` imports a real stylesheet for tokens) or get faked with JS-driven inline style toggling.

The tokens layer (`_docs/design-system/tokens/*.css`, CSS custom properties) is already real CSS, imported once in `main.jsx`. The gap is specifically at the *component* layer, where every value that should be a CSS rule is instead a JS computation re-run on every render.

## Proposal outline

- **Adopt CSS Modules** (`*.module.css`, colocated with each component) — Vite supports this with zero config, so no new build tooling. Keep design tokens (CSS custom properties) exactly as-is; module stylesheets consume `var(--...)` the same way inline styles do today.
- **Migrate incrementally, component-by-component**, starting where the JS workarounds already live: the four hover-hacking design-system core components, then the header/composer's `matchMedia` breakpoint logic. No big-bang rewrite — inline styles and CSS Modules coexist fine per-file during the transition.
- **Replace hand-rolled hover/focus JS with `:hover`/`:focus-visible` CSS** as each component migrates — net deletion of state and handlers, not just a syntax swap.
- **Keep dynamic/data-driven values inline** (e.g. a computed `StatusDot` color keyed off session state) — CSS Modules don't replace every inline style, only the static/interactive/responsive ones that are fighting the medium today.
- **Capture the decision as an ADR** before migrating anything — this reverses a stated design-system convention, not just a local refactor, and `desktop-shell-v1`'s own scoping pass already flagged it as a "capture as ADR if it's repo-wide" item.

## Risks / open questions

- **This reverses a deliberate, documented convention.** The design system explicitly states "plain React + inline styles — no CSS framework." Migrating needs a real decision (ADR), not a drive-by — get buy-in before touching component files broadly.
- **Blast radius is every screen file**, even done incrementally — this is a cross-cutting change that touches code unrelated to whatever feature prompted picking it up. Should land as its own dedicated pass, not folded into an unrelated feature diff (per the repo's own scope-creep discipline).
- **Two styling systems coexisting mid-migration** is a real maintainability cost of its own (a reviewer has to check both an inline `style` and a `.module.css` for the full picture of one component) — bound the migration window, don't let it linger indefinitely.
- **`@ds` design-system components are consumed outside this repo's client too** (they're documented as a standalone kit under `_docs/design-system/`) — confirm nothing else imports these as inline-style-only before changing their output shape.

## Trigger signals to prioritize

- The next component that needs a *second* viewport-conditional style value (one bespoke hook was tolerable; a pattern of them is the signal).
- `desktop-shell-v1` reaching its grill — that build already flagged this as a decision point it was deferring; picking up this doc there avoids making the call twice.
- Any new component reaching for `onMouseEnter`/`onMouseLeave` to fake `:hover` (the fifth instance of the same workaround).
