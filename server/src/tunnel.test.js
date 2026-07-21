'use strict';
// Every decision path is driven through injected seams (exec,
// existsClientBuild, env, scheduler) — no real tailscale, network, or board RPC.
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const {
  createTunnel,
  backoffDelay,
  urlFromDnsName,
  BACKOFF_CAP_MS,
} = require('./tunnel');

const PORT = 3017;

// A child-process stand-in matching the spawn shape the module consumes.
class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.killed = false;
  }
  kill() { this.killed = true; }
}

// Emits JSON + exit on the next microtask (listeners attach synchronously
// after exec() returns, so the emit must defer). errCode simulates a spawn
// 'error' (e.g. ENOENT).
function statusChild(json, { code = 0, errCode = null, raw = null } = {}) {
  const cp = new FakeChild();
  queueMicrotask(() => {
    if (errCode) {
      cp.emit('error', Object.assign(new Error('spawn failed'), { code: errCode }));
      return;
    }
    const out = raw != null ? raw : json != null ? JSON.stringify(json) : '';
    if (out) cp.stdout.emit('data', out);
    cp.emit('exit', code);
  });
  return cp;
}

// Injectable exec dispatching by argv: `statusResult` configures the probe
// child; serve children stay alive until a test kills them by hand.
function makeExec(statusResult) {
  const calls = [];
  const serveChildren = [];
  function exec(command, args) {
    calls.push({ command, args });
    if (args[0] === 'status') {
      return typeof statusResult === 'function' ? statusResult() : statusChild(statusResult);
    }
    // serve
    const cp = new FakeChild();
    serveChildren.push(cp);
    return cp;
  }
  exec.calls = calls;
  exec.serveChildren = serveChildren;
  exec.serveCalls = () => calls.filter((c) => c.args[0] === 'serve');
  return exec;
}

// Deterministic scheduler: captures pending timers so a test fires the
// respawn explicitly, no real sleeps.
function fakeScheduler() {
  const timers = [];
  const scheduler = {
    setTimeout(fn, ms) { const t = { fn, ms }; timers.push(t); return t; },
    clearTimeout(t) { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  };
  scheduler.timers = timers;
  scheduler.fireLast = () => {
    const t = timers.pop();
    assert.ok(t, 'expected a pending respawn timer');
    t.fn();
    return t;
  };
  return scheduler;
}

const RUNNING_STATUS = { BackendState: 'Running', Self: { DNSName: 'box.tail1234.ts.net.' } };
const EXPECTED_URL = 'https://box.tail1234.ts.net';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('backoffDelay: sub-second start, doubling, capped near 30s', () => {
  assert.strictEqual(backoffDelay(1), 500);
  assert.strictEqual(backoffDelay(2), 1000);
  assert.strictEqual(backoffDelay(3), 2000);
  assert.strictEqual(backoffDelay(4), 4000);
  assert.strictEqual(backoffDelay(5), 8000);
  assert.strictEqual(backoffDelay(6), 16000);
  // n=7 raw is 32000 → clamped to the cap
  assert.strictEqual(backoffDelay(7), BACKOFF_CAP_MS);
  assert.strictEqual(backoffDelay(20), BACKOFF_CAP_MS);
  assert.ok(backoffDelay(1) < 1000, 'first attempt is sub-second');
});

test('urlFromDnsName strips the trailing dot into an https origin', () => {
  assert.strictEqual(urlFromDnsName('box.tail1234.ts.net.'), 'https://box.tail1234.ts.net');
  assert.strictEqual(urlFromDnsName('box.tail1234.ts.net'), 'https://box.tail1234.ts.net');
  assert.strictEqual(urlFromDnsName(''), null);
  assert.strictEqual(urlFromDnsName(undefined), null);
});

// ---------------------------------------------------------------------------
// disabled
// ---------------------------------------------------------------------------

test('AR_TUNNEL unset → status disabled; start() is a no-op (no exec)', async () => {
  const exec = makeExec(RUNNING_STATUS);
  const t = createTunnel({ port: PORT, env: {}, exec, existsClientBuild: () => true });
  assert.deepStrictEqual(t.status(), { state: 'disabled', url: null, reason: null });
  await t.start();
  assert.deepStrictEqual(t.status(), { state: 'disabled', url: null, reason: null });
  assert.strictEqual(exec.calls.length, 0);
});

// ---------------------------------------------------------------------------
// precondition failures — each distinct reason, and NO child ever spawned
// ---------------------------------------------------------------------------

test('unknown provider value → down with a "supported: tailscale" reason, no spawn', async () => {
  const exec = makeExec(RUNNING_STATUS);
  const t = createTunnel({ port: PORT, env: { AR_TUNNEL: 'cloudflared' }, exec, existsClientBuild: () => true });
  await t.start();
  const s = t.status();
  assert.strictEqual(s.state, 'down');
  assert.strictEqual(s.url, null);
  assert.match(s.reason, /supported: tailscale/i);
  assert.strictEqual(exec.calls.length, 0);
});

test('AR_NO_AUTH=1 → down naming AR_NO_AUTH, no spawn (never network-exposed)', async () => {
  const exec = makeExec(RUNNING_STATUS);
  const t = createTunnel({
    port: PORT,
    env: { AR_TUNNEL: 'tailscale', AR_NO_AUTH: '1' },
    exec,
    existsClientBuild: () => true,
  });
  await t.start();
  const s = t.status();
  assert.strictEqual(s.state, 'down');
  assert.match(s.reason, /AR_NO_AUTH/);
  assert.strictEqual(exec.calls.length, 0);
});

test('no client build → down naming the build, no spawn', async () => {
  const exec = makeExec(RUNNING_STATUS);
  const t = createTunnel({
    port: PORT,
    env: { AR_TUNNEL: 'tailscale' },
    exec,
    existsClientBuild: () => false,
  });
  await t.start();
  const s = t.status();
  assert.strictEqual(s.state, 'down');
  assert.match(s.reason, /npm run build/);
  assert.strictEqual(exec.calls.length, 0);
});

test('tailscale binary missing (ENOENT) → down naming install, no serve spawn', async () => {
  const exec = makeExec(() => statusChild(null, { errCode: 'ENOENT' }));
  const t = createTunnel({
    port: PORT,
    env: { AR_TUNNEL: 'tailscale' },
    exec,
    existsClientBuild: () => true,
  });
  await t.start();
  const s = t.status();
  assert.strictEqual(s.state, 'down');
  assert.match(s.reason, /Install Tailscale/i);
  assert.strictEqual(exec.serveCalls().length, 0);
});

test('tailscale logged out → down naming "tailscale up", no serve spawn', async () => {
  const exec = makeExec({ BackendState: 'NeedsLogin', Self: {} });
  const t = createTunnel({
    port: PORT,
    env: { AR_TUNNEL: 'tailscale' },
    exec,
    existsClientBuild: () => true,
  });
  await t.start();
  const s = t.status();
  assert.strictEqual(s.state, 'down');
  assert.match(s.reason, /tailscale up/);
  assert.match(s.reason, /NeedsLogin/);
  assert.strictEqual(exec.serveCalls().length, 0);
});

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

test('happy path: serve spawned for the right port; URL discovered; status up', async () => {
  const events = [];
  const exec = makeExec(RUNNING_STATUS);
  const t = createTunnel({
    port: PORT,
    env: { AR_TUNNEL: 'tailscale' },
    exec,
    existsClientBuild: () => true,
    onEvent: (e) => events.push(e),
  });
  await t.start();

  const serve = exec.serveCalls();
  assert.strictEqual(serve.length, 1);
  assert.deepStrictEqual(serve[0].args, ['serve', String(PORT)]);

  assert.deepStrictEqual(t.status(), { state: 'up', url: EXPECTED_URL, reason: null });
  assert.deepStrictEqual(events.at(-1), { type: 'up', url: EXPECTED_URL });
});

// ---------------------------------------------------------------------------
// supervise: respawn with backoff, cap, retrying status
// ---------------------------------------------------------------------------

test('child death → capped-backoff respawn; down-retrying between, up after respawn', async () => {
  const events = [];
  const scheduler = fakeScheduler();
  const exec = makeExec(RUNNING_STATUS);
  const t = createTunnel({
    port: PORT,
    env: { AR_TUNNEL: 'tailscale' },
    exec,
    existsClientBuild: () => true,
    onEvent: (e) => events.push(e),
    scheduler,
  });
  await t.start();
  assert.strictEqual(t.status().state, 'up');

  // First death → attempt 1, delay 500ms, status down-retrying, url null.
  exec.serveChildren[0].emit('exit', 1);
  let s = t.status();
  assert.strictEqual(s.state, 'down');
  assert.strictEqual(s.url, null);
  assert.match(s.reason, /retrying in 500ms \(attempt 1\)/);
  assert.strictEqual(scheduler.timers[0].ms, 500);

  // Fire the respawn → new serve child, status up again at the SAME url.
  scheduler.fireLast();
  assert.strictEqual(exec.serveCalls().length, 2);
  assert.deepStrictEqual(t.status(), { state: 'up', url: EXPECTED_URL, reason: null });

  // Second death → backoff escalates (attempt 2, 1000ms).
  exec.serveChildren[1].emit('exit', 1);
  assert.match(t.status().reason, /retrying in 1000ms \(attempt 2\)/);
  assert.strictEqual(scheduler.timers[0].ms, 1000);

  const retryEvents = events.filter((e) => e.type === 'retry');
  assert.deepStrictEqual(retryEvents.map((e) => e.delayMs), [500, 1000]);
});

test('repeated deaths escalate the backoff to the 30s cap', async () => {
  const scheduler = fakeScheduler();
  const exec = makeExec(RUNNING_STATUS);
  const t = createTunnel({
    port: PORT,
    env: { AR_TUNNEL: 'tailscale' },
    exec,
    existsClientBuild: () => true,
    scheduler,
  });
  await t.start();

  const seen = [];
  // Kill the current child, capture the scheduled delay, respawn, repeat.
  for (let i = 0; i < 8; i++) {
    exec.serveChildren.at(-1).emit('exit', 1);
    seen.push(scheduler.timers[0].ms);
    scheduler.fireLast();
  }
  assert.deepStrictEqual(seen, [500, 1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});

// ---------------------------------------------------------------------------
// start() idempotency (no orphaned serve child)
// ---------------------------------------------------------------------------

test('start() is idempotent: a second start() while up spawns no second serve child', async () => {
  const exec = makeExec(RUNNING_STATUS);
  const t = createTunnel({ port: PORT, env: { AR_TUNNEL: 'tailscale' }, exec, existsClientBuild: () => true });
  await t.start();
  assert.strictEqual(exec.serveCalls().length, 1);
  // A second start() while up must not spawn again — the old child's
  // handlers early-return on child !== cp, so a new spawn would orphan it.
  await t.start();
  assert.strictEqual(exec.serveCalls().length, 1);
  assert.strictEqual(t.status().state, 'up');
});

test('start() while a respawn is pending does not spawn an extra child', async () => {
  const scheduler = fakeScheduler();
  const exec = makeExec(RUNNING_STATUS);
  const t = createTunnel({ port: PORT, env: { AR_TUNNEL: 'tailscale' }, exec, existsClientBuild: () => true, scheduler });
  await t.start();
  exec.serveChildren[0].emit('exit', 1); // down, backoff timer pending
  assert.strictEqual(scheduler.timers.length, 1);
  await t.start(); // backoffTimer set → guarded, no immediate spawn
  assert.strictEqual(exec.serveCalls().length, 1);
});

test('stop() then start() restarts (guard keys on live handles, not state.state)', async () => {
  const exec = makeExec(RUNNING_STATUS);
  const t = createTunnel({ port: PORT, env: { AR_TUNNEL: 'tailscale' }, exec, existsClientBuild: () => true });
  await t.start();
  t.stop(); // clears child + backoffTimer; leaves state.state === 'up'
  await t.start(); // handles are null → a fresh serve spawns despite state 'up'
  assert.strictEqual(exec.serveCalls().length, 2);
  assert.strictEqual(t.status().state, 'up');
});

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

test('stop() kills the child and prevents further respawns', async () => {
  const scheduler = fakeScheduler();
  const exec = makeExec(RUNNING_STATUS);
  const t = createTunnel({
    port: PORT,
    env: { AR_TUNNEL: 'tailscale' },
    exec,
    existsClientBuild: () => true,
    scheduler,
  });
  await t.start();
  const serve = exec.serveChildren[0];

  t.stop();
  assert.strictEqual(serve.killed, true);

  // A death arriving after stop must NOT schedule a respawn.
  serve.emit('exit', null);
  assert.strictEqual(scheduler.timers.length, 0);
  assert.strictEqual(exec.serveCalls().length, 1);
});

test('stop() during backoff clears the pending respawn timer', async () => {
  const scheduler = fakeScheduler();
  const exec = makeExec(RUNNING_STATUS);
  const t = createTunnel({
    port: PORT,
    env: { AR_TUNNEL: 'tailscale' },
    exec,
    existsClientBuild: () => true,
    scheduler,
  });
  await t.start();
  exec.serveChildren[0].emit('exit', 1);
  assert.strictEqual(scheduler.timers.length, 1);

  t.stop();
  assert.strictEqual(scheduler.timers.length, 0);
});
