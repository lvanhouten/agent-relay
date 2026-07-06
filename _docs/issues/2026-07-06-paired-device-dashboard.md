# Paired/connected devices: the dashboard can't answer "what holds a cookie right now"

**Source:** Tunnel + QR pairing grilling session, 2026-07-06 — parked deliberately while designing the auth-cookie layer (ADR 0001).
**Status:** 💡 Proposed — 2026-07-06.
**Kind:** Enhancement
**Modules:** server/src/auth (registry consult), server/src/api (device endpoints), client sessions screen (device panel)
**Severity:** Medium — visibility + revocation story for a multi-device relay.

## Motivation

Once pairing exists (tunnel + QR), multiple devices hold long-lived auth
cookies. The dashboard should display both **paired devices** (everything
holding a valid cookie: name/user-agent, issued-at, last-seen) and **connected
devices** (active right now: open WS attach or recent API polling). Today the
server deliberately keeps no record of issued cookies — verification is
stateless HMAC (ADR 0001) — so there is nothing to list.

## Proposal outline

- **Device registry**: persisted JSON beside the token file. Cookie already
  carries a random device id in its signed payload (v1 forward-compat hook);
  the registry maps device id → { name, userAgent, issuedAt, lastSeen }.
- **Consult-on-verify**: auth verification checks registry membership in
  addition to the HMAC, upgrading revocation from all-or-nothing token
  rotation to **per-device unpair** (registry delete = that cookie dies).
- **Dashboard panel**: paired-device list with last-seen and a connected-now
  badge (live WS attach or API activity within the poll window), plus an
  Unpair action per row.
- Terminology per CONTEXT.md: this is **device management** — never "session
  management" (session = PTY line).

## Risks / open questions

- Consult-on-verify makes auth stateful — the registry file becomes
  load-bearing (corrupt/missing file must fail closed for cookies, open for
  bearer token, or every device bricks with no recovery path).
- "Connected" needs a crisp definition: open WS is unambiguous; "recent poll"
  needs a threshold and reads as connected while a phone PWA polls in the
  background.
- If v1 pairing ships cookies **without** a device id, landing this later
  forces every device to re-pair — hence the v1 hook.

## Trigger signals to prioritize

- More than ~2 devices actually paired, or any shared-machine pairing.
- First "I want to revoke just my phone" moment (lost/replaced device).
- Scoped tokens work starting (`2026-07-02-scoped-tokens.md`) — same
  per-device identity substrate; sequence together.
