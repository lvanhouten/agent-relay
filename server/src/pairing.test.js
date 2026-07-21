'use strict';
// Mounts the real router behind the real dual-auth gate (makeAuthMiddleware)
// with the real cookie module and a fake tunnel status getter — no board
// RPC, no live tunnel.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');
const { createPairing, pairingUrl } = require('./pairing');
const { makeAuthMiddleware, checkToken } = require('./auth');
const { issue, setCookieHeader, verify, COOKIE_NAME } = require('./cookie');

const TOKEN = 'test-access-token-abc123';
const SECRET = 'test-signing-secret-xyz';

// Mounts the dual-auth gate in front of /api exactly as index.js does; the
// router applies no auth of its own, so this proves gate + handler end to end.
function serve(tunnelStatus = () => ({ state: 'disabled', url: null, reason: null })) {
  const app = express();
  app.use(express.json());
  const auth = makeAuthMiddleware({ expectedToken: TOKEN, signingSecret: SECRET });
  app.use('/api', auth, createPairing({
    token: TOKEN,
    checkToken,
    issue,
    setCookieHeader,
    signingSecret: SECRET,
    tunnelStatus,
  }));
  return app;
}

function request(app, method, path, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request({ port, method, path, headers }, res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      });
      req.on('error', e => { server.close(); reject(e); });
      req.end();
    });
  });
}

function validCookie() {
  return `${COOKIE_NAME}=${issue(SECRET)}`;
}

// ---- pairingUrl helper (the single fragment-URL formatter) ----------------

test('pairingUrl: token rides the fragment, never a query string; uses tunnel host', () => {
  const url = pairingUrl('https://box.tail1234.ts.net', TOKEN);
  assert.strictEqual(url, `https://box.tail1234.ts.net/#token=${TOKEN}`);
  assert.ok(url.includes(`#token=${TOKEN}`), 'token after #token=');
  assert.ok(!url.includes('?'), 'no query string');
  assert.ok(url.startsWith('https://box.tail1234.ts.net/'), 'uses the tunnel host');
});

test('pairingUrl: percent-encodes token characters that would break the fragment', () => {
  const url = pairingUrl('https://box.tail1234.ts.net', 'a b/c#d');
  assert.strictEqual(url, 'https://box.tail1234.ts.net/#token=a%20b%2Fc%23d');
});

test('pairingUrl: extracts host from a URL carrying a port/path', () => {
  assert.strictEqual(pairingUrl('https://host.ts.net:8443/serve', 'tok'), 'https://host.ts.net:8443/#token=tok');
});

test('POST /api/login with valid bearer -> 204 + a durable Set-Cookie (HttpOnly/SameSite=Strict/Path=//Max-Age)', async () => {
  const app = serve();
  const { status, headers } = await request(app, 'POST', '/api/login', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.strictEqual(status, 204);
  const setCookie = headers['set-cookie'];
  assert.ok(Array.isArray(setCookie) && setCookie.length === 1, 'exactly one Set-Cookie');
  const cookie = setCookie[0];
  assert.match(cookie, new RegExp(`^${COOKIE_NAME}=`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=\d+/);
  const value = cookie.slice(`${COOKIE_NAME}=`.length).split(';')[0];
  assert.strictEqual(verify(value, SECRET).ok, true);
});

test('POST /api/login over http -> Set-Cookie has NO Secure flag (would never be stored)', async () => {
  const app = serve();
  const { headers } = await request(app, 'POST', '/api/login', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.doesNotMatch(headers['set-cookie'][0], /Secure/);
});

test('POST /api/login with a proxy-forwarded https proto -> Set-Cookie IS Secure', async () => {
  const app = serve();
  const { headers } = await request(app, 'POST', '/api/login', {
    headers: { authorization: `Bearer ${TOKEN}`, 'x-forwarded-proto': 'https' },
  });
  assert.match(headers['set-cookie'][0], /Secure/);
});

test('POST /api/login with a valid cookie but NO bearer -> 401, no Set-Cookie (a cookie must not mint a cookie)', async () => {
  const app = serve();
  const { status, headers } = await request(app, 'POST', '/api/login', {
    headers: { cookie: validCookie() },
  });
  assert.strictEqual(status, 401);
  assert.strictEqual(headers['set-cookie'], undefined);
});

test('POST /api/login with an invalid bearer -> 401, no Set-Cookie', async () => {
  const app = serve();
  const { status, headers } = await request(app, 'POST', '/api/login', {
    headers: { authorization: 'Bearer not-the-token' },
  });
  assert.strictEqual(status, 401);
  assert.strictEqual(headers['set-cookie'], undefined);
});

test('POST /api/login with no credentials at all -> 401, no Set-Cookie', async () => {
  const app = serve();
  const { status, headers } = await request(app, 'POST', '/api/login');
  assert.strictEqual(status, 401);
  assert.strictEqual(headers['set-cookie'], undefined);
});

test('GET /api/pairing unauthenticated -> 401', async () => {
  const app = serve();
  const { status } = await request(app, 'GET', '/api/pairing');
  assert.strictEqual(status, 401);
});

test('GET /api/pairing authed (cookie) with tunnel UP -> pairing URL uses tunnel host, token in fragment, no query token', async () => {
  const app = serve(() => ({ state: 'up', url: 'https://box.tail1234.ts.net', reason: null }));
  const { status, body } = await request(app, 'GET', '/api/pairing', {
    headers: { cookie: validCookie() },
  });
  assert.strictEqual(status, 200);
  const parsed = JSON.parse(body);
  assert.deepStrictEqual(parsed.tunnel, { state: 'up', reason: null });
  assert.strictEqual(parsed.pairingUrl, `https://box.tail1234.ts.net/#token=${TOKEN}`);
  assert.ok(parsed.pairingUrl.includes(`#token=${TOKEN}`), 'token after #token=');
  assert.ok(!parsed.pairingUrl.includes('?'), 'no query string in the pairing URL');
  assert.ok(parsed.pairingUrl.startsWith('https://box.tail1234.ts.net/'), 'uses the tunnel host');
});

test('GET /api/pairing authed (bearer) with tunnel UP -> same pairing URL', async () => {
  const app = serve(() => ({ state: 'up', url: 'https://box.tail1234.ts.net', reason: null }));
  const { status, body } = await request(app, 'GET', '/api/pairing', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(JSON.parse(body).pairingUrl, `https://box.tail1234.ts.net/#token=${TOKEN}`);
});

test('GET /api/pairing authed with tunnel DOWN -> pairingUrl null, reason carried', async () => {
  const reason = 'Tailscale is installed but not logged in (backend state: NeedsLogin). Run "tailscale up" to log in.';
  const app = serve(() => ({ state: 'down', url: null, reason }));
  const { status, body } = await request(app, 'GET', '/api/pairing', {
    headers: { cookie: validCookie() },
  });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(JSON.parse(body), { tunnel: { state: 'down', reason }, pairingUrl: null });
});

test('GET /api/pairing authed with tunnel DISABLED -> pairingUrl null', async () => {
  const app = serve(() => ({ state: 'disabled', url: null, reason: null }));
  const { status, body } = await request(app, 'GET', '/api/pairing', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(JSON.parse(body), { tunnel: { state: 'disabled', reason: null }, pairingUrl: null });
});
