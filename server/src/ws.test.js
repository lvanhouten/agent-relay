'use strict';
// Tests the credential step of the origin -> credential -> session gate,
// over a real http server + `ws` client with a fully faked board. Credentials
// are injected into createWSHub, so the decision is hermetic (no ambient
// env/credentials file, no RPC).
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const WebSocket = require('ws');
const { createWSHub } = require('./ws');
const { issue } = require('./cookie');

const SECRET = 'ws-signing-secret';
const EXPECTED = 'ws-token';
const ID = 's1';

// whenAttached resolves once the gate lets attach() run — the signal the
// credential check passed (else 1008 fires first).
function makeSessions() {
  let resolveAttached;
  const whenAttached = new Promise(r => { resolveAttached = r; });
  return {
    whenAttached,
    get: async () => ({ id: ID, status: 'running' }),
    // Part of the real surface ws.js calls on input; kept so ws.js needn't
    // optional-chain around an incomplete double.
    clearAttention() {},
    attach: async () => {
      resolveAttached();
      return { detach() {}, write() {}, resize() {} };
    },
  };
}

// One upgrade attempt: resolves { attached: true } if the gate passed, or
// { closed: code } if refused (1008). Loopback origin, so only the
// credential step is under test.
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

// Drives input + resize repeatedly and reports what got through each gate.
// `modeFrame`, when given, is sent once at open to set the capabilities.
function driveFrames(query, modeFrame) {
  return new Promise((resolve, reject) => {
    const wrote = [], resized = [];
    let cleared = 0;
    const sessions = {
      get: async () => ({ id: ID, status: 'running' }),
      clearAttention() { cleared++; },
      attach: async () => ({
        detach() {}, write(d) { wrote.push(d); }, resize(c, r) { resized.push([c, r]); },
        setSizing() {},
      }),
    };
    const server = http.createServer();
    createWSHub(server, sessions, cfg);
    server.listen(0, () => {
      const { port } = server.address();
      const client = new WebSocket(`ws://localhost:${port}/sessions/${ID}?token=${encodeURIComponent(EXPECTED)}${query}`);
      client.on('error', reject);
      client.on('open', () => {
        if (modeFrame) client.send(JSON.stringify({ type: 'mode', ...modeFrame }));
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

test('WS: a `follow` connection types into the line but never sizes it', async () => {
  // The focused grid pane. Input and sizing are independent gates precisely so
  // this combination exists: fusing them let a pane clamp the shared PTY to a
  // thumbnail's geometry, which the board then kept after the pane unfocused.
  const { wrote, resized, cleared } = await driveFrames('', { input: true, sizing: false });
  assert.ok(wrote.length > 0 && wrote.every(d => d === 'x'), 'input reaches the line');
  assert.deepStrictEqual(resized, [], 'resize never reaches the line — the shared PTY is not clamped');
  assert.ok(cleared > 0, 'typing still clears the attention flag');
});

test('WS: sizing without input is honored as stated — the gates are independent', async () => {
  const { wrote, resized } = await driveFrames('', { input: false, sizing: true });
  assert.deepStrictEqual(wrote, [], 'input is gated');
  assert.ok(resized.length > 0 && resized.every(([c, r]) => c === 80 && r === 24), 'resize is not');
});

test('WS: a legacy `spectator` mode frame still gates both, rather than reading absent caps as false', async () => {
  // A tab loaded before the input/sizing split sends {spectator}. Reading the
  // missing fields as false would leave such a tab unable to type at all.
  const denied = await driveFrames('', { spectator: true });
  assert.deepStrictEqual(denied.wrote, [], 'legacy spectator:true withholds input');
  assert.deepStrictEqual(denied.resized, [], 'legacy spectator:true withholds sizing');
  const allowed = await driveFrames('', { spectator: false });
  assert.ok(allowed.wrote.length > 0, 'legacy spectator:false grants input');
  assert.ok(allowed.resized.length > 0, 'legacy spectator:false grants sizing');
});

test('WS: a live `mode` frame re-gates the connection and the control socket without reattaching (ADR-0005)', async () => {
  const wrote = [];
  const sizingCalls = [];
  let attachCount = 0;
  const sessions = {
    get: async () => ({ id: ID, status: 'running' }),
    clearAttention() {},
    attach: async () => {
      attachCount++;
      return { detach() {}, write(d) { wrote.push(d); }, resize() {}, setSizing: (on) => sizingCalls.push(on) };
    },
  };
  const server = http.createServer();
  createWSHub(server, sessions, cfg);
  await new Promise((res) => server.listen(0, res));
  const { port } = server.address();
  const client = new WebSocket(`ws://localhost:${port}/sessions/${ID}?token=${encodeURIComponent(EXPECTED)}`);
  await new Promise((res) => client.on('open', res));
  const send = (o) => client.send(JSON.stringify(o));

  // Withhold both, then try to drive: input must be dropped.
  send({ type: 'mode', input: false, sizing: false });
  await new Promise((r) => setTimeout(r, 100));
  send({ type: 'input', payload: 'a' });
  await new Promise((r) => setTimeout(r, 100));

  // Grant input but not sizing (a focused pane): input reaches the line, and the
  // control socket stays closed so the line is not clamped.
  send({ type: 'mode', input: true, sizing: false });
  await new Promise((r) => setTimeout(r, 100));
  send({ type: 'input', payload: 'b' });
  await new Promise((r) => setTimeout(r, 100));

  // Grant sizing too (a full-size view): the control socket opens.
  send({ type: 'mode', input: true, sizing: true });
  await new Promise((r) => setTimeout(r, 150));

  client.close();
  await new Promise((res) => server.close(res));

  assert.strictEqual(attachCount, 1, 'a mode flip reuses the connection — never a reattach');
  assert.deepStrictEqual(sizingCalls, [false, false, true], 'setSizing follows each mode frame');
  assert.deepStrictEqual(wrote, ['b'], 'input dropped while withheld, delivered once granted');
});

// Opens a connection whose get() AND attach() each take a real delay, sends
// `frames` once at open (never resent), and reports what reached the line. The
// client's real first frames — `mode` + the fitted `resize` — arrive inside that
// window, so this is the shape that regressed: with no 'message' listener yet
// attached, `ws` emitted them into the void. BOTH awaits must be slow: the
// listener has to be registered in the connection handler's first synchronous
// block, and a fake `get` that resolves on a microtask hides a listener
// registered just after it.
async function sendAtOpen(frames, { stepDelayMs = 60, query = '' } = {}) {
  const wrote = [], resized = [], sizingCalls = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const sessions = {
    get: async () => {
      await sleep(stepDelayMs);
      return { id: ID, status: 'running' };
    },
    clearAttention() {},
    attach: async () => {
      await sleep(stepDelayMs);
      return {
        detach() {},
        write(d) { wrote.push(d); },
        resize(c, r) { resized.push([c, r]); },
        setSizing: (on) => sizingCalls.push(on),
      };
    },
  };
  const server = http.createServer();
  createWSHub(server, sessions, cfg);
  await new Promise(res => server.listen(0, res));
  const { port } = server.address();
  const client = new WebSocket(`ws://localhost:${port}/sessions/${ID}?token=${encodeURIComponent(EXPECTED)}${query}`);
  await new Promise(res => client.on('open', res));
  for (const f of frames) client.send(JSON.stringify(f));
  await sleep(stepDelayMs * 2 + 200);
  client.close();
  await new Promise(res => server.close(res));
  return { wrote, resized, sizingCalls };
}

test('WS: a resize sent at open survives the attach window — sized once, never resent', async () => {
  // The client fits xterm and pushes its grid the instant the socket opens,
  // milliseconds ahead of the board RPCs. Dropping it left the PTY at its
  // pre-attach size, so every TUI drew for the wrong grid until the operator
  // resized the window by hand.
  const { resized } = await sendAtOpen([{ type: 'resize', cols: 137, rows: 41 }]);
  assert.deepStrictEqual(resized, [[137, 41]], 'the open-time resize reached the line exactly once');
});

test('WS: frames sent at open are delivered in arrival order', async () => {
  const { wrote, resized } = await sendAtOpen([
    { type: 'input', payload: 'a' },
    { type: 'resize', cols: 100, rows: 30 },
    { type: 'input', payload: 'b' },
  ]);
  assert.deepStrictEqual(wrote, ['a', 'b'], 'buffered input drains in order');
  assert.deepStrictEqual(resized, [[100, 30]], 'the interleaved resize lands too');
});

test('WS: a `mode` frame sent at open gates the frames queued behind it', async () => {
  // Ordering is load-bearing: the capability frame must apply before the input
  // and resize buffered behind it, or a watch-only pane would drive the line.
  const { wrote, resized, sizingCalls } = await sendAtOpen([
    { type: 'mode', input: false, sizing: false },
    { type: 'input', payload: 'x' },
    { type: 'resize', cols: 80, rows: 24 },
  ]);
  assert.deepStrictEqual(sizingCalls, [false], 'the open-time mode frame is honored');
  assert.deepStrictEqual(wrote, [], 'input behind it is gated');
  assert.deepStrictEqual(resized, [], 'resize behind it is gated — the shared PTY is not clamped');
});

test('WS: a pane that opens as `follow` sizes nothing, even with its fitted resize queued at open', async () => {
  // The regression path in full: a grid pane's first frames are `mode` + the
  // resize its own fit produced. Both are buffered pre-attach, so the gate has
  // to hold for the queued frame too, not just for later ones.
  const { wrote, resized } = await sendAtOpen([
    { type: 'mode', input: true, sizing: false },
    { type: 'resize', cols: 84, rows: 43 },
    { type: 'input', payload: 'k' },
  ]);
  assert.deepStrictEqual(resized, [], 'the pane never clamps the line');
  assert.deepStrictEqual(wrote, ['k'], 'but it still types into it');
});

test('WS: a sessions store missing clearAttention still delivers input, and the failure is logged', async () => {
  // Contract-drift case: the write must still land, and the TypeError must
  // log — not vanish into the malformed-message catch.
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
    client.on('open', () => client.send(JSON.stringify({ type: 'input', payload: 'y' })));
    await whenWritten;
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
