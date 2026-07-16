'use strict';
// WS upgrade-gate credential tests. The gate order is
// origin → credential → session lookup; this file exercises the credential step
// (token-or-cookie) end-to-end over a real http server + `ws` client, with the
// board fully faked. No RPC, no AGENT_RELAY_PIPE. Credentials are injected into
// createWSHub so the decision is hermetic (independent of the ambient env /
// persisted credentials file).
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const WebSocket = require('ws');
const { createWSHub } = require('./ws');
const { issue } = require('./cookie');

const SECRET = 'ws-signing-secret';
const EXPECTED = 'ws-token';
const ID = 's1';

// A fake sessions store: the target line is live and attachable. `whenAttached`
// resolves the moment the gate lets the request through to attach — the signal
// that the credential check passed (an unauthorized request closes 1008 before
// ever reaching attach).
function makeSessions() {
  let resolveAttached;
  const whenAttached = new Promise(r => { resolveAttached = r; });
  return {
    whenAttached,
    get: async () => ({ id: ID, status: 'running' }),
    // Part of the real BoardSessions surface ws.js calls on input — the fixture
    // carries it so ws.js needn't optional-chain around an incomplete double.
    clearAttention() {},
    attach: async () => {
      resolveAttached();
      return { detach() {}, write() {}, resize() {} };
    },
  };
}

// Run one upgrade attempt against a fresh server. Resolves { attached: true } if
// the credential gate passed (attach reached) or { closed: code } if the socket
// was closed first (1008 unauthorized). Origin is loopback (default host), so
// the origin gate passes and the credential step is what's under test.
function attempt(authConfig, { token, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const sessions = makeSessions();
    const server = http.createServer();
    createWSHub(server, sessions, authConfig);
    server.listen(0, () => {
      const { port } = server.address();
      const qs = token !== undefined ? `?token=${encodeURIComponent(token)}` : '';
      const headers = cookie ? { cookie } : {};
      const client = new WebSocket(`ws://localhost:${port}/sessions/${ID}${qs}`, { headers });
      let done = false;
      const finish = (v) => { if (done) return; done = true; try { client.close(); } catch {} server.close(); resolve(v); };
      client.on('close', (code) => finish({ closed: code }));
      client.on('error', () => { /* close event follows */ });
      sessions.whenAttached.then(() => finish({ attached: true }));
      setTimeout(() => { finish({ timeout: true }); }, 3000).unref();
    });
  });
}

const cfg = { expectedToken: EXPECTED, signingSecret: SECRET };
const validCookie = () => `ar_auth=${issue(SECRET)}`;

test('WS: valid ?token=, no cookie → attach proceeds', async () => {
  assert.deepStrictEqual(await attempt(cfg, { token: EXPECTED }), { attached: true });
});

test('WS: no token, valid cookie → attach proceeds', async () => {
  assert.deepStrictEqual(await attempt(cfg, { cookie: validCookie() }), { attached: true });
});

test('WS: no token, tampered cookie → close 1008', async () => {
  assert.deepStrictEqual(await attempt(cfg, { cookie: `ar_auth=${issue(SECRET)}x` }), { closed: 1008 });
});

test('WS: no token, cookie signed by a different secret → close 1008', async () => {
  assert.deepStrictEqual(await attempt(cfg, { cookie: `ar_auth=${issue('other-secret')}` }), { closed: 1008 });
});

test('WS: neither credential → close 1008', async () => {
  assert.deepStrictEqual(await attempt(cfg, {}), { closed: 1008 });
});

test('WS: wrong token → close 1008', async () => {
  assert.deepStrictEqual(await attempt(cfg, { token: 'wrong' }), { closed: 1008 });
});

test('WS: AR_NO_AUTH (expectedToken null) → attach proceeds with no credential', async () => {
  assert.deepStrictEqual(await attempt({ expectedToken: null, signingSecret: SECRET }, {}), { attached: true });
});

// Drive one connection (interactive or spectator) and record what the attach
// handle received. Sends an input + a resize frame repeatedly for a settle
// window after the socket opens (the real message listener registers only after
// the async attach, so a single send would race it), then reports the sinks.
function driveFrames(query) {
  return new Promise((resolve, reject) => {
    const wrote = [], resized = [];
    let cleared = 0;
    const sessions = {
      get: async () => ({ id: ID, status: 'running' }),
      clearAttention() { cleared++; },
      attach: async () => ({ detach() {}, write(d) { wrote.push(d); }, resize(c, r) { resized.push([c, r]); } }),
    };
    const server = http.createServer();
    createWSHub(server, sessions, cfg);
    server.listen(0, () => {
      const { port } = server.address();
      const client = new WebSocket(`ws://localhost:${port}/sessions/${ID}?token=${encodeURIComponent(EXPECTED)}${query}`);
      client.on('error', reject);
      client.on('open', () => {
        const input = JSON.stringify({ type: 'input', payload: 'x' });
        const resize = JSON.stringify({ type: 'resize', cols: 80, rows: 24 });
        const timer = setInterval(() => { client.send(input); client.send(resize); }, 40);
        setTimeout(() => {
          clearInterval(timer);
          client.close();
          server.close(() => resolve({ wrote, resized, cleared }));
        }, 400).unref();
      });
    });
  });
}

test('WS: interactive connection (no mode) delivers input and resize to the line', async () => {
  const { wrote, resized, cleared } = await driveFrames('');
  assert.ok(wrote.length > 0 && wrote.every(d => d === 'x'), 'input reached the line');
  assert.ok(resized.length > 0 && resized.every(([c, r]) => c === 80 && r === 24), 'resize reached the line');
  assert.ok(cleared > 0, 'input cleared the attention flag');
});

test('WS: ?mode=spectator drops inbound input and resize, dropped not errored (ADR-0005)', async () => {
  const { wrote, resized, cleared } = await driveFrames('&mode=spectator');
  assert.deepStrictEqual(wrote, [], 'spectator input never reaches the line');
  assert.deepStrictEqual(resized, [], 'spectator resize never reaches the line — the shared PTY is not clamped');
  assert.strictEqual(cleared, 0, 'a spectator does not clear the attention flag');
});

test('WS: a live `mode` frame toggles the input gate and control socket without reattaching (ADR-0005)', async () => {
  // The grid flips focus by sending a `mode` frame on the OPEN socket, not by
  // reconnecting. Assert: (1) the same attach handle is reused (attach called
  // once), (2) setSpectator tracks the frame, (3) input is gated by the current
  // mode — dropped while spectator, delivered once flipped back.
  const wrote = [];
  const spectatorCalls = [];
  let attachCount = 0;
  const sessions = {
    get: async () => ({ id: ID, status: 'running' }),
    clearAttention() {},
    attach: async () => {
      attachCount++;
      return { detach() {}, write(d) { wrote.push(d); }, resize() {}, setSpectator: (on) => spectatorCalls.push(on) };
    },
  };
  const server = http.createServer();
  createWSHub(server, sessions, cfg);
  await new Promise((res) => server.listen(0, res));
  const { port } = server.address();
  const client = new WebSocket(`ws://localhost:${port}/sessions/${ID}?token=${encodeURIComponent(EXPECTED)}`);
  await new Promise((res) => client.on('open', res));
  const send = (o) => client.send(JSON.stringify(o));

  // Flip to spectator, then try to drive: input must be dropped.
  send({ type: 'mode', spectator: true });
  await new Promise((r) => setTimeout(r, 100));
  send({ type: 'input', payload: 'a' });
  await new Promise((r) => setTimeout(r, 100));

  // Flip back to interactive: input now reaches the line.
  send({ type: 'mode', spectator: false });
  await new Promise((r) => setTimeout(r, 100));
  send({ type: 'input', payload: 'b' });
  await new Promise((r) => setTimeout(r, 150));

  client.close();
  await new Promise((res) => server.close(res));

  assert.strictEqual(attachCount, 1, 'a mode flip reuses the connection — never a reattach');
  assert.deepStrictEqual(spectatorCalls, [true, false], 'setSpectator follows each mode frame');
  assert.deepStrictEqual(wrote, ['b'], 'input dropped while spectator, delivered once interactive');
});

test('WS: a sessions store missing clearAttention still delivers input, and the failure is logged', async () => {
  // The contract-drift case: clearAttention renamed/omitted. The keystroke must
  // reach the line (write happens first) and the TypeError must surface as a
  // greppable log line — NOT vanish into the malformed-message catch.
  const written = [];
  let resolveWritten;
  const whenWritten = new Promise(r => { resolveWritten = r; });
  const sessions = {
    get: async () => ({ id: ID, status: 'running' }),
    // clearAttention deliberately MISSING.
    attach: async () => ({ detach() {}, write(d) { written.push(d); resolveWritten(); }, resize() {} }),
  };
  const errors = [];
  const origError = console.error;
  console.error = (...args) => { errors.push(args.join(' ')); };
  try {
    const server = http.createServer();
    createWSHub(server, sessions, cfg);
    await new Promise(res => server.listen(0, res));
    const { port } = server.address();
    const client = new WebSocket(`ws://localhost:${port}/sessions/${ID}?token=${encodeURIComponent(EXPECTED)}`);
    // The message listener registers only after the async attach completes, so
    // re-send until the write lands rather than racing a single send.
    const frame = JSON.stringify({ type: 'input', payload: 'y' });
    const timer = setInterval(() => { if (client.readyState === WebSocket.OPEN) client.send(frame); }, 50);
    await whenWritten;
    clearInterval(timer);
    client.close();
    await new Promise(res => server.close(res));
  } finally {
    console.error = origError;
  }
  assert.strictEqual(written[0], 'y', 'input is delivered before the clearAttention failure');
  assert.ok(
    errors.some(e => e.includes('[ws] clearAttention failed')),
    `expected a clearAttention error log, got: ${JSON.stringify(errors)}`,
  );
});
