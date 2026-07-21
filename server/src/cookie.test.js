'use strict';
// Pure module (secret injected, no disk/env) — every path exercised with
// literal secrets and hand-built values.
const test = require('node:test');
const assert = require('node:assert');
const {
  issue,
  verify,
  setCookieHeader,
  readAuthCookie,
  COOKIE_NAME,
  LIFETIME_MS,
  MAX_AGE_SECONDS,
} = require('./cookie');

const SECRET = 'test-signing-secret';

test('round-trip: verify(issue(secret), secret) is ok with a device id', () => {
  const value = issue(SECRET);
  const result = verify(value, SECRET);
  assert.strictEqual(result.ok, true);
  assert.ok(typeof result.deviceId === 'string' && result.deviceId.length > 0);
});

test('each issue mints a distinct device id', () => {
  const a = verify(issue(SECRET), SECRET);
  const b = verify(issue(SECRET), SECRET);
  assert.strictEqual(a.ok, true);
  assert.strictEqual(b.ok, true);
  assert.notStrictEqual(a.deviceId, b.deviceId);
});

test('tampering with the device id fails verification', () => {
  const [v, deviceId, issuedAt, sig] = issue(SECRET).split('.');
  const tampered = [v, deviceId.slice(0, -1) + (deviceId.endsWith('A') ? 'B' : 'A'), issuedAt, sig].join('.');
  assert.strictEqual(verify(tampered, SECRET).ok, false);
});

test('tampering with the issued-at fails verification', () => {
  const [v, deviceId, issuedAt, sig] = issue(SECRET).split('.');
  const tampered = [v, deviceId, String(Number(issuedAt) + 1), sig].join('.');
  assert.strictEqual(verify(tampered, SECRET).ok, false);
});

test('tampering with the signature fails verification', () => {
  const [v, deviceId, issuedAt, sig] = issue(SECRET).split('.');
  const tampered = [v, deviceId, issuedAt, sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A')].join('.');
  assert.strictEqual(verify(tampered, SECRET).ok, false);
});

test('a value signed with a different secret fails verification', () => {
  const value = issue(SECRET);
  assert.strictEqual(verify(value, 'other-secret').ok, false);
});

test('an issued-at older than the lifetime fails even with a valid HMAC', () => {
  // issue() bakes in Date.now(), so freeze it to mint a stale token, then
  // restore it before verify() checks against real time.
  const realNow = Date.now;
  try {
    Date.now = () => realNow() - LIFETIME_MS - 60_000;
    const stale = issue(SECRET);
    Date.now = realNow;
    assert.strictEqual(verify(stale, SECRET).ok, false);
  } finally {
    Date.now = realNow;
  }
});

test('an issued-at just inside the lifetime still verifies', () => {
  const realNow = Date.now;
  try {
    Date.now = () => realNow() - LIFETIME_MS + 60_000;
    const fresh = issue(SECRET);
    Date.now = realNow;
    assert.strictEqual(verify(fresh, SECRET).ok, true);
  } finally {
    Date.now = realNow;
  }
});

test('malformed inputs return not-ok and never throw', () => {
  const cases = [
    '',
    'v1',
    'v1.deviceonly',
    'v1.dev.notanumber.sig',
    'v1.dev.123',
    'v1.dev.123.sig.extra',
    'v2.dev.123.sig',
    'v1..123.sig',
    'v1.dev.-5.sig',
    'v1.dev.1.5.sig',
    undefined,
    null,
    42,
    {},
  ];
  for (const c of cases) {
    const result = verify(c, SECRET);
    assert.strictEqual(result.ok, false, `expected not-ok for ${JSON.stringify(c)}`);
    assert.strictEqual(result.deviceId, null);
  }
});

test('setCookieHeader always includes HttpOnly, SameSite=Strict, Path=/ and Max-Age', () => {
  const header = setCookieHeader('abc', { secure: false });
  assert.ok(header.startsWith(`${COOKIE_NAME}=abc`));
  assert.match(header, /(^|; )HttpOnly(;|$)/);
  assert.match(header, /(^|; )SameSite=Strict(;|$)/);
  assert.match(header, /(^|; )Path=\/(;|$)/);
  assert.match(header, new RegExp(`(^|; )Max-Age=${MAX_AGE_SECONDS}(;|$)`));
});

test('setCookieHeader includes Secure only when asked', () => {
  assert.doesNotMatch(setCookieHeader('abc', { secure: false }), /Secure/);
  assert.doesNotMatch(setCookieHeader('abc'), /Secure/);
  assert.match(setCookieHeader('abc', { secure: true }), /(^|; )Secure$/);
});

test('readAuthCookie finds the cookie among several', () => {
  const value = issue(SECRET);
  const header = `theme=dark; ${COOKIE_NAME}=${value}; other=1`;
  assert.strictEqual(readAuthCookie(header), value);
});

test('readAuthCookie returns null when absent or header missing', () => {
  assert.strictEqual(readAuthCookie('theme=dark; other=1'), null);
  assert.strictEqual(readAuthCookie(''), null);
  assert.strictEqual(readAuthCookie(undefined), null);
  assert.strictEqual(readAuthCookie(null), null);
});

test('readAuthCookie value round-trips through verify', () => {
  const value = issue(SECRET);
  const header = `a=b; ${COOKIE_NAME}=${value}`;
  assert.strictEqual(verify(readAuthCookie(header), SECRET).ok, true);
});
