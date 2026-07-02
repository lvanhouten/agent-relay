# Permission prompts can't be answered from the notification itself

**Source:** Feature-gap brainstorm, 2026-07-02 — radical extension of hook-driven push: the most common remote action (approve/deny a permission prompt) shouldn't require opening a terminal at all.
**Status:** 💡 Proposed — 2026-07-02.
**Kind:** Enhancement
**Modules:** client/sw, server/api, server/ws (input path)
**Severity:** High value, but strictly sequenced after push notifications.

## Motivation

With push notifications (`2026-07-02-hook-driven-push-notifications.md`) you learn a session is blocked; you still have to open the PWA, attach the terminal, and type `1` on a soft keyboard. Web Push notifications support **action buttons** — a "waiting on permission" notification could carry Approve / Deny, and tapping one sends the canned keystroke down the line without the app ever opening. The relay becomes a remote control for agent checkpoints, not just a viewer.

## Proposal outline

- **REST input endpoint** — input is currently WS-only (`server/src/ws.js` inbound `input` frames). Add `POST /api/sessions/:id/input` (authed, `application/json` like the existing POST guard in `src/api.js`), writing via the same `BoardSessions.attach`/data-pipe path or a short-lived attach-write-detach. Needed because a service worker answering a notification has no WS. (medium)
- `POST /api/notify` gains an optional `actions: [{ title, input }]` array, forwarded into the push payload. The *hook* defines what the buttons send (e.g. `"1\r"` / `"2\r"`), not the relay. (small)
- `sw.js` `notificationclick`: if `event.action` matches, `fetch` the input endpoint with the canned bytes; otherwise open the app on the session. (small)
- Auth for the SW's fetch: the SW needs a credential at notification-click time. Cleanest is a scoped, input-only, per-session token minted into the push payload — see `2026-07-02-scoped-tokens.md`; the fallback (full token cached in the SW) works but over-grants. (medium, shared with scoped-tokens)

## Risks / open questions

- **Blind approval** is the real hazard: the notification shows a one-line summary, not the terminal. Mitigations: the hook includes the tool name/command summary in the notification body (Claude Code's `Notification` hook payload carries the message); Deny is always safe; consider making Approve open the app instead when the hook flags the action as high-risk.
- A canned `input` is raw bytes typed into a PTY — validate length and restrict to a small allowlist shape server-side so a compromised push payload can't type arbitrary script into a shell.
- Sequencing: worthless without push delivery; do `2026-07-02-hook-driven-push-notifications.md` first.

## Trigger signals to prioritize

- Push notifications land and the first user reaction is "now I have to open the app anyway."
- Recurring pattern of sessions blocked on yes/no prompts during AFK runs (exactly the full-repo-audit-style multi-session workflow).
