# No proactive notification when a session needs attention

**Source:** Feature-gap brainstorm, 2026-07-02 — the relay's core use-case is checking on agent sessions from another device, but nothing ever reaches out to you; you have to open the app and look.
**Status:** 💡 Proposed — 2026-07-02.
**Kind:** Enhancement
**Modules:** server/api, client/sw, Claude Code hooks (external config)
**Severity:** High value — the single feature that most changes what the product is.

## Motivation

Today the relay is pull-only: the sessions screen polls every 5s while the tab is open, and that's the entire awareness story. The moment you lock the phone or switch apps, a session can sit blocked on a permission prompt for an hour. The PWA shell already exists (`client/manifest.json`, `client/sw.js`), so the delivery half of Web Push is mostly wiring — what's missing is the subscription plumbing and a trigger.

The clean trigger is **not** output-scraping. Claude Code has first-class `Notification` and `Stop` hooks that fire exactly when a session wants attention or finishes; a hook that POSTs to the relay is both simpler and more truthful than heuristics over PTY bytes.

## Proposal outline

- Generate and persist a VAPID keypair next to the board secret (`%LOCALAPPDATA%\agent-relay\`), same owner-only-file posture. (small)
- Add `web-push` to the server; store push subscriptions (in-memory + JSON file survive web-tier restarts) behind `authMiddleware`: `POST /api/push/subscribe`, `DELETE /api/push/subscribe`. (medium)
- Add `POST /api/notify` (authed): accepts `{ sessionId, title, body }`, fans out to all subscriptions. Deliberately dumb — the relay doesn't decide *when* to notify, callers do. (small)
- Document a Claude Code hook recipe: `Notification` and `Stop` hooks that `curl` the endpoint with `AR_TOKEN` from the environment. Ship it as a copy-paste snippet in the README. (small)
- `sw.js`: `push` handler shows the notification; `notificationclick` opens/focuses the app on the session (deep-linking into the manual screen-state navigation in `App.jsx` is the only client-side wrinkle — there's no router). (small–medium)

## Risks / open questions

- **Web Push requires a secure origin** (HTTPS, or localhost). Real remote use therefore depends on the tunnel story — see `2026-07-02-tunnel-qr-pairing.md`. Same-machine/localhost use works today.
- **Payload discipline:** push payloads transit Google/Mozilla/Apple push services. Keep them to "session `name` needs attention" — never session output (which could carry PHI/secrets given what runs in these shells).
- Mapping a hook firing in some repo to a board line id: the hook knows its cwd and pid, not the line id. Cheapest bridge: the relay matches on cwd against `list`; more precise: an env var (`AGENT_RELAY_SESSION`) injected when the line is spawned with a `run` command.

## Trigger signals to prioritize

- Any real AFK usage — the first time a session sits blocked while the operator is away is this feature's whole argument.
- `2026-07-02-tunnel-qr-pairing.md` landing (unlocks the secure-origin requirement for real devices).
