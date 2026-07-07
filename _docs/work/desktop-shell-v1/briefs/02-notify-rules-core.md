# 02 — Notification rules core

## Agent Brief

**Category:** enhancement
**Summary:** Pure notification reducer: diff consecutive session-poll results and return the desktop notifications to fire for sessions that *entered* needs-input, suppressed while the window is focused.

**Current behavior:**
The session DTO already carries the attention state (`status: 'needs-input'` set by the server when a Claude Code Notification hook reports a blocked prompt; cleared on next input/output). Nothing client-side reacts to it beyond the pulsing card dot.

**Desired behavior:**
A new pure module in the client's TypeScript core deciding, with no Notification API access, *what to notify* given two consecutive poll results and the window focus state:

- A spec is emitted for each session whose status is `needs-input` in the new list but was **not** `needs-input` in the previous list — a *transition*, not a state.
- A session absent from the previous list that arrives already in `needs-input` (first poll after load, web-tier restart) is **not** a transition — no spec. This guards against a notification burst on the first poll.
- `windowFocused: true` suppresses everything — the reducer returns an empty list. The pulsing sidebar dot is the persistent, state-based signal; notifications are transition-based only (PRD decision; VC-23).
- Each spec carries the session's id as its `tag` so the Notification API replaces rather than stacks on re-fire, plus a human-readable title/body naming the session.
- Sessions leaving needs-input, exiting, or staying in needs-input across polls emit nothing.

**Key interfaces:**

- `NotificationSpec` — `{ sessionId: string; tag: string; title: string; body: string }` with `tag === sessionId` (exported; brief 06 consumes it).
- `notifyTransitions(prev: Session[], next: Session[], windowFocused: boolean): NotificationSpec[]` — pure over the existing core `Session` DTO type.

**Acceptance criteria:**

- [ ] Transition matrix fully tested: enter needs-input (spec), stay in needs-input (nothing), leave needs-input (nothing), enter while focused (nothing), new-session-already-flagged on first sight (nothing), several sessions entering in one poll (one spec each), and tag equals the session id in every spec.
- [ ] All tests pass via the client workspace's test script; each guard proven by mutation per repo convention.
- [ ] Client typecheck stays green.

**Out of scope:**

- Calling the Notification API, permission handling, the bell toggle, click handling (brief 06).
- Any change to how `needs-input` is produced server-side or cleared.
- Notifications for `idle` or `exited` transitions.
- Any blur-time sweep of already-flagged sessions (deliberate non-behavior, VC-23).

**Depends on:** none

**Covers:** VC-16, VC-17, VC-19, VC-23

**Runtime:** parallel-safe
