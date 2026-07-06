## Agent Brief

**Category:** enhancement
**Summary:** Tunnel supervisor module: precondition checks with degrade reasons, `tailscale serve` spawn, tailnet URL discovery, capped-backoff respawn, queryable status

**Current behavior:**
The relay listens on localhost only; any tunnel is set up by hand outside the process. The server has no knowledge of a public URL.

**Desired behavior:**
A new server module owning the tunnel lifecycle for `AR_TUNNEL=tailscale` (value-based env scheme; other values are unknown → treated as a failed precondition with a "supported values" reason). It **never throws and never exits the process** — every failure is a degrade to local-only, surfaced through its status and an event/callback the wiring layer turns into console warnings.

- **Preconditions** (each failure yields a distinct, actionable reason): the tailscale CLI is present and logged in; the built client exists (a tunnel to a page-less server is useless — same "is there a build" check the static router does); auth is enabled (`AR_NO_AUTH=1` unconditionally refuses to start a tunnel — the ADR/issue hard requirement, satisfied by degrade).
- **Start**: run `tailscale serve` in foreground mode proxying the relay port (config reverts when the child dies). Discover the stable tailnet URL from the tailscale CLI's JSON status output (machine DNS name), not by scraping the serve child's stdout.
- **Supervise**: if the child exits while the relay runs, respawn with capped exponential backoff (sub-second start, cap around 30s), logging each attempt through the same event seam. The tailnet URL is stable, so a respawn restores the same pairing.
- **Status**: queryable at any time — `'up'` (with the URL), `'down'` (with reason: a precondition failure or a died-and-retrying state), or `'disabled'` (AR_TUNNEL unset). This is the shape the pairing endpoint and wiring consume.
- **Stop**: kills the child and stops respawning (for graceful shutdown).

Process spawning, filesystem checks, and the environment are injected so every decision path is unit-testable without tailscale installed; no live tunnel in any test.

**Key interfaces:**

- `createTunnel({ port, env, exec, existsClientBuild, onEvent }) → { start(), stop(), status() }` (seam names indicative — keep injectability and the exact status shape).
- `status() → { state: 'up'|'down'|'disabled', url: string|null, reason: string|null }` — the cross-brief contract consumed by the pairing endpoints and the server wiring.
- Backoff progression exposed or observable enough to unit-test the sequence and cap.

**Acceptance criteria:**

- [ ] `AR_TUNNEL` unset → status `disabled`; `start()` is a no-op.
- [ ] Each precondition failure (no binary, logged out, no client build, `AR_NO_AUTH=1`, unknown provider value) → status `down` with a distinct reason naming the fix; no child ever spawned.
- [ ] Happy path (injected fake exec): serve child spawned for the right port; URL discovered from canned tailscale JSON status; status flips to `up` with the https tailnet URL.
- [ ] Child death → respawn attempts with the documented backoff progression and cap (fake timers/injected scheduler fine); status reads `down` with a retrying reason between attempts, `up` after a successful respawn.
- [ ] `stop()` terminates the child and prevents further respawns.
- [ ] No test touches a real tailscale binary or network.

**Out of scope:**

- Console/QR presentation of the URL (server-wiring brief consumes the events).
- Origin allowlisting of the discovered URL (origin brief + wiring).
- cloudflared or any second provider (PRD out-of-scope) — but don't foreclose it: the provider is a value, not a boolean.

**Depends on:** none

**Covers:** VC-1, VC-11, VC-12, VC-13

**Runtime:** parallel-safe
