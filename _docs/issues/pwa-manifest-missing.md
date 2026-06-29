# App cannot be installed on mobile home screen — no PWA manifest or service worker

**Source:** Identified during scaffold review (2026-06-29) — original finding "PWA manifest".
**Status:** Deferred — 2026-06-29.
**Kind:** Enhancement
**Modules:** client/pwa
**Severity:** Low

## What's already been closed

Nothing — this is a net-new addition.

## What remains

No `manifest.json`, no service worker, and no `<link rel="manifest">` in `client/index.html`. The app cannot be installed as a PWA on iOS or Android.

Affected files:
- `client/index.html` — missing manifest link and theme-color meta
- `client/public/` — directory doesn't exist yet; manifest and icons go here
- `client/vite.config.js` — may need `vite-plugin-pwa` or manual SW registration

## Fix outline

- Add `client/public/manifest.json` with `name`, `short_name`, `start_url`, `display: standalone`, `background_color`, `theme_color`, and an `icons` array (at minimum 192×192 and 512×512 PNG).
- Add icons to `client/public/` — the logo mark SVG in `_docs/design-system/assets/logo-mark.svg` can be the source.
- Add `<link rel="manifest" href="/manifest.json">` and a `<meta name="theme-color">` to `client/index.html`.
- Add a minimal service worker for offline shell caching (cache the app shell on install; network-first for API calls). Either use `vite-plugin-pwa` (Workbox-backed, low effort) or a hand-rolled `sw.js` registered in `client/src/main.jsx`.
- Test "Add to Home Screen" on iOS Safari and Android Chrome.
- Estimated cost: **small** if using `vite-plugin-pwa`; **medium** if hand-rolling the service worker.

## Trigger signals to reopen

- Before any mobile-focused demo or release.
- User requests home screen install.
- Lighthouse PWA audit score becomes a target metric.

## Repro

1. Open the app in Chrome on Android or Safari on iOS.
2. Tap the browser share/menu — "Add to Home Screen" is absent or produces a plain bookmark rather than an installed app.
3. Run Lighthouse in Chrome DevTools → PWA category shows multiple failing checks.
