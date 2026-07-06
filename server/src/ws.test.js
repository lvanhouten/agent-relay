'use strict';
// WS upgrade-gate credential tests (VC-6/VC-8/VC-17). The gate order is
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
