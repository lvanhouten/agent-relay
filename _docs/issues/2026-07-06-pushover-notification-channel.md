# Push a phone notification when a session needs attention — via Pushover, sidestepping the Web Push stack

**Source:** Remote-notification investigation, 2026-07-06 — validated a tenant-free push channel end-to-end after the Microsoft Teams routes all dead-ended (see Risks).
**Status:** ✅ Landed — 2026-07-06. Notifier seam (`server/src/notifiers.js`), `POST /api/notify` (fans out to sinks + flags the needs-input card), env config (`AR_PUSHOVER_TOKEN`/`AR_PUSHOVER_USER`), and the Claude Code hook recipe (README). Built together with the `needs-input` attention state — they share the `/api/notify` plumbing.
**Kind:** Enhancement
**Modules:** server/api (notifier module + `/api/notify`), Claude Code hooks (external config). **No client/SW work** — that's the point.
**Severity:** High value — the concrete, unblocked delivery half of `2026-07-02-hook-driven-push-notifications.md`.

## Motivation

Same core need as the Web Push doc (`2026-07-02-hook-driven-push-notifications.md`): the relay is pull-only, so a session can sit blocked on a prompt for an hour while the phone is locked. That doc's delivery mechanism (Web Push) is **blocked on a secure origin** — it needs the tunnel/App Proxy story to land before it works on a real remote device. Given the office DNS-filter reality (`[[remote-access-deployment-reality]]`; Tailscale degrades at work), that blocker is not close.

**Pushover sidesteps the entire dependency chain.** It's a consumer push service: the relay makes one outbound HTTPS POST, Pushover's own app renders the notification on the phone. No VAPID, no service-worker `push`/`notificationclick` plumbing, no secure-origin requirement, no tunnel, no Entra tenant, no IT ticket, no per-month license. ~$5 one-time per platform.

**Validated end-to-end 2026-07-06** from the office desktop: `POST https://api.pushover.net/1/messages.json` with `token` + `user` + `message`/`title` → rendered on the phone. Critically, **the office DNS filter does not block `api.pushover.net`** (unlike Tailscale), so the relay→Pushover outbound POST survives the work network; the phone receives over cellular regardless.

## Proposal outline

- A pluggable **notifier** seam in the server: an interface `notify({ title, body, url, priority })` with a Pushover implementation. Keep it pluggable so a Teams webhook (if the free Workflows path ever pans out) or Web Push can be added as additional sinks without touching callers. (small)
- **Config via env / the existing board secret-file pattern** (`%LOCALAPPDATA%\agent-relay\`), never hardcoded: `AR_PUSHOVER_TOKEN` (app API key) + `AR_PUSHOVER_USER` (user key). Absent → notifier is a no-op, feature simply off. (small)
- `POST /api/notify` (authed, behind `authMiddleware`): accepts `{ sessionId, title, body }`, fans out to all configured notifiers. Deliberately dumb — the relay doesn't decide *when*, callers do. (Shared design with the Web Push doc; build it once, both sinks hang off it.) (small)
- Document a **Claude Code hook recipe**: `Notification` and `Stop` hooks that `curl` the endpoint with `AR_TOKEN` from the environment. Ship as a copy-paste README snippet. (small)
- **Pushover extras worth exposing** through the notifier interface: `priority=1` (bypass quiet hours), `priority=2` (repeat until acknowledged — right for a genuinely blocked session), and the `url` field to deep-link into the relay on tap. (small)

## Risks / open questions

- **Payload discipline (unchanged from the parent doc):** payloads transit Pushover's servers. Keep them to "session `name` needs attention" — never session output, which can carry PHI/secrets given what runs in these shells.
- **Line-id bridge (shared problem):** a hook knows its cwd + pid, not the board line id. Cheapest bridge: relay matches on cwd against `list`; more precise: an env var (`AGENT_RELAY_SESSION`) injected when the line is spawned with a `run` command.
- **Token storage on Windows:** same inert-`mode`-bits caveat as the board secret file (`2026-07-01-secret-file-acl-verification.md`) — the real boundary is the inherited profile ACL.
- **Pushover limits:** 10,000 messages/month on the free tier per app — a runaway hook loop could burn that; the notifier should be resilient to a non-200 (log, don't crash the caller).
- **Relationship to the Web Push doc:** this is *not* a replacement — it's the pragmatic now-path that works before the secure-origin stack exists. Web Push stays the eventual PWA-native channel (no third-party app, no per-platform cost). Both hang off the same `/api/notify`. The Teams alternatives are dead in this tenant: Graph app-registration is blocked (user lacks directory rights; the desktop `az` CLI's broad scopes are an over-consented first-party client, not a personal grant), and Power Automate Workflows isn't enabled + the generic HTTP trigger needs the ~$15/mo premium plan.

## Trigger signals to prioritize

- Any real AFK usage — the first time a session sits blocked while the operator is away is this feature's whole argument.
- Pairs naturally with the RDP phone path (`2026-07-06-rdp-mobile-session-recipe.md`): the notification tells you to connect; the RD app is how you act on it.
- Landing this unblocks the parent hook-driven-push doc's *trigger* half (the hook recipe + `/api/notify`) independently of its Web Push *delivery* half.
