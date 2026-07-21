---
status: accepted
date: 2026-07-11
deciders: Lukas Van Houten (owner), Claude (advisor)
---

# 0006 — SCSS Modules for app-owned styling; @ds keeps injected `<style>`

## Context

The client grew three styling mechanisms in parallel, split by layer:

- **`screens/` + `chrome/`** — inline `style={{}}` objects. Inline styles can't
  express `@media`, `:hover`, `:focus-visible`, or `@keyframes` at all, so every
  responsive or interactive requirement got a bespoke JS workaround (e.g.
  `core/useMediaQuery.ts` for the terminal header's title-width breakpoint;
  `prefersComposer()`'s mount-time `matchMedia`).
- **`desktop/`** (the newest code — desktop shell v1, #51) — colocated
  `.module.css` consuming `var(--...)` tokens. Real stylesheets, scoped, no JS.
- **`@ds/` core kit** (`_docs/design-system/components/core/*.jsx`) — each
  component injects a `<style>` singleton at runtime (`_injected` guard +
  `typeof document` SSR guard) with global `.rl-*` classes. Already real CSS
  (`:hover`, `:focus-visible`, `@keyframes`, `prefers-reduced-motion`) — **not**
  inline styles.

The stated "plain React + inline styles — no CSS framework" convention lived in
`CLAUDE.md` and the design-system prompt docs, never in an ADR. The desktop
shell had already broken from it to CSS Modules. The owner prefers SCSS
(their day-job stack) and dislikes inline styles.

`_docs/issues/2026-07-09-inline-styles-to-stylesheets.md` proposed migrating to
CSS Modules, but was written against a stale premise (it claimed the `@ds`
components hand-rolled hover with `onMouseEnter`/`onMouseLeave` JS — grep
confirms **zero** such handlers anywhere; the `@ds` layer solved hover/focus via
injected CSS well before this doc). This ADR supersedes both the inline-styles
convention and that doc's framing.

## Decision

**App-owned UI uses SCSS Modules; the `@ds` kit keeps its injected `<style>`.**

1. **SCSS Modules (`.module.scss`) are the standard for `client/src`.** Colocated
   per component, scoped/hashed class names, `import styles from './X.module.scss'`,
   `className={styles.foo}`. `screens/` + `chrome/` migrate off inline;
   `desktop/`'s `.module.css` files rename to `.module.scss`. `sass` is a client
   devDependency; Vite compiles `.module.scss` with no extra config.
2. **Design tokens stay CSS custom properties.** `_docs/design-system/tokens/*.css`
   is unchanged; stylesheets consume `var(--...)` exactly as inline styles did.
   Runtime `data-theme` theming requires real custom properties — SCSS
   compile-time variables cannot switch themes at runtime, so tokens are **not**
   ported to `$scss` variables.
3. **Genuinely dynamic per-render values stay inline.** A `style` prop keyed off
   component state (a computed color, a measured width) remains inline or is
   passed as a CSS custom property; SCSS Modules replace only the static,
   interactive, and responsive styles that were fighting the medium.
4. **`@ds` core components keep injected `<style>`.** They are already
   class-based real CSS (not the inline styling being removed) and double as a
   **zero-build portable kit**: `_docs/design-system/_ds_bundle.js` is a
   self-contained IIFE that inlines each component's injected CSS, loaded by two
   standalone preview pages (`core.card.html`, `ui_kits/agent-relay/index.html`)
   via a bare `<script src>` with no bundler. Injected `<style>` is what makes
   that work; `.module.scss` imports are meaningless without a bundler, and there
   is no in-repo generator to rebuild the bundle. Converting `@ds` would strand
   the preview harness on stale CSS for no functional gain.

## Considered and rejected

- **Convert `@ds` to `.module.scss` too (full uniformity).** One mechanism
  everywhere, but breaks the standalone preview bundle/pages (no in-repo
  regenerator; the bundle assumes self-contained injected CSS). The owner's
  actual grievance is inline `style={{}}` — which `@ds` has none of — so
  uniformity-for-its-own-sake here costs a working portable kit with zero
  offsetting benefit.
- **Plain CSS Modules (`.module.css`), no SCSS.** Already in use in `desktop/`
  and sufficient functionally. Rejected only on authoring ergonomics: SCSS
  nesting (`&:hover`), and the owner's existing SCSS fluency. `.module.css`
  files are valid `.module.scss`, so the rename is lossless.
- **Global SCSS partials with a BEM-style naming convention** (mirroring the
  `@ds` `.rl-*` scheme). Rejected: reintroduces manual global-namespace
  collision management that scoped modules eliminate for free.
- **Port tokens to SCSS `$variables`.** Rejected outright — kills runtime theme
  switching, which the whole app depends on via `data-theme`.

## Consequences

- Two mechanisms coexist by design: SCSS Modules (app) + injected `<style>`
  (`@ds` kit). This is a deliberate layer split, not migration debt — `@ds` is
  a portable library, `client/src` is the app that consumes it.
- `core/useMediaQuery.ts` and `prefersComposer()` stay where they gate
  *behavior* (which component renders, a stored preference). Where a `matchMedia`
  hook only drove a *style* (the terminal header title width), the responsive
  value moves into a `@media` rule in the colocated `.module.scss`.
- The migration is cross-cutting across every app screen; it lands as its own
  dedicated pass/branch, not folded into a feature diff.
- `_docs/issues/2026-07-09-inline-styles-to-stylesheets.md` is closed by this
  ADR (its premise was stale; the decision it asked for is recorded here).

## Amendment (2026-07-21) — the app vendors its own SCSS-Module copy

Decision #4 above assumed the app would keep *consuming* the `@ds` kit in its
injected-`<style>` form, so "convert `@ds` to SCSS Modules" read as an
all-or-nothing choice that would strand the preview harness. That framing was
wrong: it conflated the app's dependency with the kit itself.

The app was importing UI-kit components straight out of `_docs/design-system/`,
which was only ever meant as an inspiration-template source, not a runtime
dependency. We split the two:

- The 9 components the app uses (`Button`, `Input`, `IconButton`, `StatusDot`,
  `Card`, `Badge`, `OverflowMenu`, `Kbd`, `Toast`) plus the token stylesheets
  were copied into `client/src/ds/` and `client/src/styles/`. The `@ds` alias
  and the `main.jsx` token import now point at the app-owned copies; `client/src`
  no longer reaches into `_docs`.
- The app's copy was converted to colocated `.module.scss` — the class-based CSS
  moved verbatim out of the runtime-injected `<style>` singletons, so `ds/` is
  now uniform with the rest of `client/src`. This supersedes #4 **for the app**.
- The `_docs/design-system/` originals are unchanged and keep their injected
  `<style>` form; `_ds_bundle.js` + the standalone preview pages still work off
  them exactly as before. #4's rationale therefore still holds for the template
  kit — copying instead of converting-in-place is what preserved it.

Net: the "two mechanisms coexist" split is now a *repo* split (app = SCSS
Modules, template kit = injected `<style>`), not a within-`client/src` one.
