'use strict';
// Token-policy tests. resolveToken is pure over an env object, so the three
// shapes (opt-out / pinned / generated) are pinned here without mutating
// process.env; checkToken takes the token as an injectable second parameter for
// the same reason.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');
const { resolveToken, checkToken, isAuthenticated, makeAuthMiddleware } = require('./auth');
const { issue } = require('./cookie');

const SECRET = 'test-signing-secret';
const EXPECTED = 'the-token';
const validCookieHeader = () => `ar_auth=${issue(SECRET)}`;

test('resolveToken: AR_NO_AUTH=1 disables auth explicitly', () => {
  assert.deepStrictEqual(resolveToken({ AR_NO_AUTH: '1' }), { token: null, generated: false });
});

test('resolveToken: AR_TOKEN pins a stable token', () => {
  assert.deepStrictEqual(resolveToken({ AR_TOKEN: 'pinned' }), { token: 'pinned', generated: false });
});

test('resolveToken: unset env generates a fresh per-run token, not an open relay', () => {
  const a = resolveToken({});
  const b = resolveToken({});
  assert.strictEqual(a.generated, true);
  assert.ok(typeof a.token === 'string' && a.token.length >= 32, 'token must have real entropy');
  assert.notStrictEqual(a.token, b.token, 'each run gets its own token');
});

test('checkToken: matches only the exact token', () => {
  assert.strictEqual(checkToken('secret', 'secret'), true);
  assert.strictEqual(checkToken('wrong', 'secret'), false);
  assert.strictEqual(checkToken('', 'secret'), false);
  assert.strictEqual(checkToken(undefined, 'secret'), false);
});

test('checkToken: passes everything when auth is disabled (token null)', () => {
  assert.strictEqual(checkToken(undefined, null), true);
  assert.strictEqual(checkToken('anything', null), true);
});

// ---------------------------------------------------------------------------
// isAuthenticated — the shared REST/WS decision (bearer-or-cookie).
// expectedToken/signingSecret are injected so no env games are needed.
// ---------------------------------------------------------------------------

test('isAuthenticated: valid bearer, no cookie → true', () => {
  assert.strictEqual(
    isAuthenticated({ token: EXPECTED, cookieHeader: undefined, expectedToken: EXPECTED, signingSecret: SECRET }),
    true,
  );
});

test('isAuthenticated: no bearer, valid cookie → true', () => {
  assert.strictEqual(
    isAuthenticated({ token: undefined, cookieHeader: validCookieHeader(), expectedToken: EXPECTED, signingSecret: SECRET }),
    true,
  );
});

test('isAuthenticated: no bearer, tampered cookie → false', () => {
  const tampered = `ar_auth=${issue(SECRET)}x`; // mutate the signature
  assert.strictEqual(
    isAuthenticated({ token: undefined, cookieHeader: tampered, expectedToken: EXPECTED, signingSecret: SECRET }),
    false,
  );
});

test('isAuthenticated: cookie signed by a different secret → false', () => {
  const wrongSecret = `ar_auth=${issue('some-other-secret')}`;
  assert.strictEqual(
    isAuthenticated({ token: undefined, cookieHeader: wrongSecret, expectedToken: EXPECTED, signingSecret: SECRET }),
    false,
  );
});

test('isAuthenticated: neither credential → false', () => {
  assert.strictEqual(
    isAuthenticated({ token: '', cookieHeader: undefined, expectedToken: EXPECTED, signingSecret: SECRET }),
    false,
  );
  assert.strictEqual(
    isAuthenticated({ token: 'wrong', cookieHeader: 'ar_auth=garbage', expectedToken: EXPECTED, signingSecret: SECRET }),
    false,
  );
});

test('isAuthenticated: expectedToken null (AR_NO_AUTH) → always true', () => {
  assert.strictEqual(
    isAuthenticated({ token: undefined, cookieHeader: undefined, expectedToken: null, signingSecret: SECRET }),
    true,
  );
  assert.strictEqual(
    isAuthenticated({ token: 'anything', cookieHeader: 'ar_auth=garbage', expectedToken: null, signingSecret: SECRET }),
    true,
  );
});

test('isAuthenticated: a wrong bearer still passes on a valid cookie (fallback, not short-circuit)', () => {
  assert.strictEqual(
    isAuthenticated({ token: 'wrong', cookieHeader: validCookieHeader(), expectedToken: EXPECTED, signingSecret: SECRET }),
    true,
  );
});

// ---------------------------------------------------------------------------
// makeAuthMiddleware — the REST gate end-to-end (real Express + http).
// ---------------------------------------------------------------------------

function serve(mwOpts) {
  const app = express();
  app.use(makeAuthMiddleware(mwOpts));
  app.get('/x', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

function request(app, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request({ port, method: 'GET', path: '/x', headers }, res => {
        res.on('data', () => {});
        res.on('end', () => { server.close(); resolve({ status: res.statusCode }); });
      });
      req.on('error', e => { server.close(); reject(e); });
      req.end();
    });
  });
}

test('authMiddleware: valid bearer, no cookie → 200', async () => {
  const app = serve({ expectedToken: EXPECTED, signingSecret: SECRET });
  const { status } = await request(app, { authorization: `Bearer ${EXPECTED}` });
  assert.strictEqual(status, 200);
});

test('authMiddleware: no bearer, valid cookie → 200', async () => {
  const app = serve({ expectedToken: EXPECTED, signingSecret: SECRET });
  const { status } = await request(app, { cookie: validCookieHeader() });
  assert.strictEqual(status, 200);
});

test('authMiddleware: no bearer, tampered cookie → 401', async () => {
  const app = serve({ expectedToken: EXPECTED, signingSecret: SECRET });
  const { status } = await request(app, { cookie: `ar_auth=${issue(SECRET)}x` });
  assert.strictEqual(status, 401);
});

test('authMiddleware: neither credential → 401', async () => {
  const app = serve({ expectedToken: EXPECTED, signingSecret: SECRET });
  const { status } = await request(app, {});
  assert.strictEqual(status, 401);
});

test('authMiddleware: AR_NO_AUTH (expectedToken null) → 200 with no credential', async () => {
  const app = serve({ expectedToken: null, signingSecret: SECRET });
  const { status } = await request(app, {});
  assert.strictEqual(status, 200);
});
