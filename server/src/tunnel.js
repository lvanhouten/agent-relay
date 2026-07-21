'use strict';
// Tunnel supervisor for AR_TUNNEL=tailscale — owns `tailscale serve`'s lifecycle.
// NEVER throws or exits the process: every failure degrades to local-only via
// status() + the onEvent seam (index.js turns events into console output). The
// relay must keep working local-only even when the tunnel can't come up.
//
// Injected seams, so every path is unit-testable with no tailscale and no live tunnel:
//   - exec(command, args)  -> spawn-shaped child: .stdout ('data'), 'exit'(code), 'error'(err), .kill()
//   - existsClientBuild()  -> bool, same check the static router uses (client/dist/index.html)
//   - env                  -> AR_TUNNEL / AR_NO_AUTH
//   - scheduler            -> {setTimeout, clearTimeout} for backoff (fake timers in tests)
const path = require('path');
const fs = require('fs');
const child_process = require('child_process');

const DIST_INDEX = path.join(__dirname, '..', '..', 'client', 'dist', 'index.html');

// Provider is a VALUE, not a boolean, so future providers (cloudflared, ...) add
// values here rather than new flags. An unknown value is a distinct, actionable
// precondition failure, not a crash.
const SUPPORTED_PROVIDERS = ['tailscale'];

// Capped exponential backoff for respawn: sub-second first attempt, doubling,
// capped near 30s. Exported so the sequence/cap are directly testable. `attempt` is 1-based.
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

  // Invariant pinned by tests: url is non-null IFF state==='up'. 'disabled' =
  // AR_TUNNEL unset; 'down' = a precondition failure or died-and-retrying.
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

  // Runs `tailscale status --json` once, for both the login precondition
  // (BackendState==='Running') and stable-URL discovery (Self.DNSName) — the URL
  // comes from CLI status, never scraped from the serve child's stdout. Never rejects.
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
        // Any spawn error means we can't run tailscale — uniformly "missing";
        // the caller only branches on that flag.
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

  // Ordered precondition gate — sync/cheap checks first, the CLI probe last.
  // Each failure yields a distinct, actionable reason. Returns true only when
  // safe to spawn `tailscale serve`.
  async function preconditionsOk() {
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      degrade(
        `AR_TUNNEL=${JSON.stringify(provider)} is not a supported tunnel provider ` +
        `(supported: ${SUPPORTED_PROVIDERS.join(', ')}). Unset AR_TUNNEL or set AR_TUNNEL=tailscale.`
      );
      return false;
    }
    // Hard security requirement: an unauthenticated relay must never be
    // network-exposed. AR_NO_AUTH=1 unconditionally refuses.
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

  // Spawns the foreground `tailscale serve <port>` (foreground mode reverts the
  // serve config on child death). No readiness signal is available (URL
  // discovery is via status, not serve stdout), so a live spawn counts as "up";
  // on exit/error, respawn with backoff.
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

  // The serve child died and the relay is still running: escalate backoff and
  // schedule a respawn. Between attempts, status is 'down' with the retrying
  // reason; URL stays stable so a successful respawn restores the same pairing.
  // Backoff resets only in start() — there's no readiness signal to safely reset
  // on otherwise, so escalating toward the cap on a flap is the conservative choice.
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
    // Idempotent: a live child or pending backoff timer means a serve process
    // already exists (or will) — re-entering would orphan a second child (its
    // handlers early-return on the `child !== cp` guard). Guards on the live
    // HANDLES, not `state.state === 'up'`, because stop() clears them but leaves
    // state 'up' — keying on state would break a stop()-then-start() restart.
    if (child || backoffTimer) return;
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
