'use strict';
// Tunnel supervisor — owns the lifecycle of `tailscale serve` for the value-based
// env scheme AR_TUNNEL=tailscale. It NEVER throws and NEVER exits the process:
// every failure is a degrade to local-only, surfaced through status() and the
// onEvent seam the wiring layer (brief 07) turns into console warnings. The
// relay must keep working local-only even when the tunnel can't come up — a
// tunnel problem never takes down desk work (PRD story 10, VC-11/12).
//
// Everything the module touches beyond pure logic is an injected seam:
//   - exec(command, args)   → a child-process-like object (spawn shape): has
//                             `.stdout` (EventEmitter, 'data'), emits 'exit'
//                             (code) and 'error' (err), and has `.kill()`.
//   - existsClientBuild()   → bool; the same "is there a build" check the static
//                             router does (client/dist/index.html present).
//   - env                   → the environment object (AR_TUNNEL / AR_NO_AUTH).
//   - scheduler             → { setTimeout, clearTimeout } for backoff (fake
//                             timers in tests — never a real sleep).
// So every decision path is unit-testable with no tailscale installed and no
// live tunnel (see tunnel.test.js).
const path = require('path');
const fs = require('fs');
const child_process = require('child_process');

const DIST_INDEX = path.join(__dirname, '..', '..', 'client', 'dist', 'index.html');

// Provider is a VALUE, not a boolean — future providers (cloudflared, ...) add
// values here rather than new flags. V1 ships tailscale only (PRD out-of-scope),
// but an unknown value is a distinct, actionable precondition failure, not a
// crash.
const SUPPORTED_PROVIDERS = ['tailscale'];

// Capped exponential backoff for respawn. Sub-second first attempt, doubling,
// capped near 30s. Exported (with the constants) so the sequence and cap are
// directly unit-testable without driving a live child. `attempt` is 1-based.
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 30_000;
function backoffDelay(attempt) {
  const raw = BACKOFF_BASE_MS * 2 ** (attempt - 1);
  return Math.min(raw, BACKOFF_CAP_MS);
}

// Strip a tailscale MagicDNS name (trailing-dot FQDN) into an https origin.
// e.g. "machine.tail1234.ts.net." → "https://machine.tail1234.ts.net".
function urlFromDnsName(dnsName) {
  if (!dnsName || typeof dnsName !== 'string') return null;
  return `https://${dnsName.replace(/\.$/, '')}`;
}

function createTunnel({
  port,
  env = process.env,
  exec = child_process.spawn,
  existsClientBuild = () => fs.existsSync(DIST_INDEX),
  onEvent = () => {},
  scheduler = { setTimeout, clearTimeout },
} = {}) {
  const provider = env.AR_TUNNEL;

  // Invariant pinned by tests: url is a non-null string IFF state === 'up'.
  // 'disabled' means AR_TUNNEL unset; 'down' means a precondition failure or a
  // died-and-retrying state (reason always names the situation / the fix).
  let state = provider
    ? { state: 'down', url: null, reason: null }
    : { state: 'disabled', url: null, reason: null };

  let child = null;        // the live `tailscale serve` child, or null
  let stopped = false;     // stop() latch — suppresses all respawns
  let attempt = 0;         // backoff attempt counter (monotonic per start cycle)
  let backoffTimer = null; // pending respawn timer handle
  let tailnetUrl = null;   // stable URL discovered from `tailscale status`

  function emit(event) {
    try { onEvent(event); } catch { /* wiring's problem, never ours */ }
  }

  function status() {
    return { ...state };
  }

  // A precondition failed: degrade to local-only. No child is ever spawned.
  function degrade(reason) {
    state = { state: 'down', url: null, reason };
    emit({ type: 'degraded', reason });
  }

  // Run `tailscale status --json` once. Serves double duty: the login
  // precondition (BackendState === 'Running') AND stable-URL discovery
  // (Self.DNSName) — the URL comes from the CLI's JSON status, never from
  // scraping the serve child's stdout. Resolves a plain verdict object; never
  // rejects.
  function probeTailscale() {
    return new Promise((resolve) => {
      let out = '';
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };

      let cp;
      try {
        cp = exec('tailscale', ['status', '--json']);
      } catch (err) {
        // Synchronous spawn failure (e.g. no such file) — treat as missing.
        return done({ missing: true });
      }

      cp.on('error', () => {
        // Any spawn error — ENOENT (binary not on PATH) or otherwise — means we
        // can't run tailscale, so it's uniformly "missing". (No discrimination
        // here: the caller only branches on `missing`.)
        done({ missing: true });
      });
      if (cp.stdout && cp.stdout.on) cp.stdout.on('data', (d) => { out += d; });
      cp.on('exit', (code) => {
        let json;
        try { json = JSON.parse(out); } catch {
          return done({ missing: false, loggedIn: false, backendState: 'unparseable', url: null });
        }
        const backendState = json.BackendState;
        const loggedIn = backendState === 'Running';
        const url = urlFromDnsName(json.Self && json.Self.DNSName);
        done({ missing: false, loggedIn, backendState, url });
      });
    });
  }

  // Ordered precondition gate. Sync, cheap checks first; the CLI probe last.
  // Each failure yields a distinct reason naming the fix. Returns true only when
  // it is safe to spawn `tailscale serve`.
  async function preconditionsOk() {
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      degrade(
        `AR_TUNNEL=${JSON.stringify(provider)} is not a supported tunnel provider ` +
        `(supported: ${SUPPORTED_PROVIDERS.join(', ')}). Unset AR_TUNNEL or set AR_TUNNEL=tailscale.`
      );
      return false;
    }
    // Hard security requirement (VC-12, the ADR/issue): an unauthenticated relay
    // must never be network-exposed. AR_NO_AUTH=1 unconditionally refuses.
    if (env.AR_NO_AUTH === '1') {
      degrade(
        'Refusing to start a tunnel while auth is disabled (AR_NO_AUTH=1) — an ' +
        'unauthenticated relay must never be network-exposed. Unset AR_NO_AUTH to enable the tunnel.'
      );
      return false;
    }
    // A tunnel to a page-less server is useless — same check the static router does.
    if (!existsClientBuild()) {
      degrade(
        'No client build found (client/dist) — a tunnel to a page-less server is useless. ' +
        'Run "npm run build" first.'
      );
      return false;
    }
    const probe = await probeTailscale();
    if (probe.missing) {
      degrade(
        'The tailscale CLI was not found on PATH. Install Tailscale ' +
        '(https://tailscale.com/download) to use AR_TUNNEL=tailscale.'
      );
      return false;
    }
    if (!probe.loggedIn) {
      degrade(
        `Tailscale is installed but not logged in (backend state: ${probe.backendState}). ` +
        'Run "tailscale up" to log in.'
      );
      return false;
    }
    if (!probe.url) {
      degrade(
        'Tailscale is logged in but reported no MagicDNS name — enable MagicDNS and ' +
        'HTTPS certificates on your tailnet, then restart.'
      );
      return false;
    }
    tailnetUrl = probe.url; // stable; reused across respawns without re-scan.
    return true;
  }

  // Spawn the foreground `tailscale serve <port>`. Foreground mode reverts the
  // serve config when the child dies. We have no readiness signal we're allowed
  // to read (URL discovery is via status, not serve stdout), so a live spawn is
  // treated as "up". On exit/error while the relay runs, respawn with backoff.
  function spawnServe() {
    if (stopped) return;
    let cp;
    try {
      cp = exec('tailscale', ['serve', String(port)]);
    } catch (err) {
      return scheduleRespawn(`spawn failed: ${err && err.message}`);
    }
    child = cp;

    cp.on('error', (err) => {
      if (child !== cp) return;
      child = null;
      scheduleRespawn(`process error: ${err && err.message}`);
    });
    cp.on('exit', (code) => {
      if (child !== cp) return; // stale child (killed by stop / superseded)
      child = null;
      scheduleRespawn(`process exited (code ${code})`);
    });

    state = { state: 'up', url: tailnetUrl, reason: null };
    emit({ type: 'up', url: tailnetUrl });
  }

  // The serve child died and the relay is still running: escalate the backoff
  // counter and schedule a respawn. Between attempts, status is 'down' with a
  // retrying reason; the URL is stable so a successful respawn restores the same
  // pairing (VC-13). Backoff is monotonic within a start cycle (reset only by
  // start()) — there is no readiness signal to safely reset it on, and a rare
  // flap escalating toward the 30s cap is the correct conservative behavior.
  function scheduleRespawn(reason) {
    if (stopped) return;
    attempt += 1;
    const delayMs = backoffDelay(attempt);
    state = {
      state: 'down',
      url: null,
      reason: `Tunnel process ${reason}; retrying in ${delayMs}ms (attempt ${attempt}).`,
    };
    emit({ type: 'retry', attempt, delayMs, reason });
    backoffTimer = scheduler.setTimeout(() => {
      backoffTimer = null;
      spawnServe();
    }, delayMs);
  }

  async function start() {
    if (state.state === 'disabled') return; // AR_TUNNEL unset — no-op.
    stopped = false;
    attempt = 0;
    const ok = await preconditionsOk();
    if (!ok) return; // degrade() already set the down state + reason.
    spawnServe();
  }

  // Graceful shutdown: kill the child and stop all respawns.
  function stop() {
    stopped = true;
    if (backoffTimer) {
      scheduler.clearTimeout(backoffTimer);
      backoffTimer = null;
    }
    if (child) {
      try { child.kill(); } catch { /* already gone */ }
      child = null;
    }
  }

  return { start, stop, status };
}

module.exports = {
  createTunnel,
  backoffDelay,
  urlFromDnsName,
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  SUPPORTED_PROVIDERS,
};
