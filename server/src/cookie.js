'use strict';
// Stateless HMAC-signed auth cookie (ADR 0001). This module owns the browser's
// durable credential — always the *auth cookie*, never a "session cookie"
// (per CONTEXT.md a session is a PTY line, not a browser identity).
//
// Pure/stateless by contract: no I/O, no process.env, no clock beyond Date.now()
// at mint. The signing secret is passed in by the caller (credentials.js owns
// where it comes from) — this module never touches disk. That keeps it trivially
// unit-testable and keeps the secret's provenance in exactly one place.
//
// Encoding is `v1.<deviceId>.<issuedAt>.<sig>` — its own parser, deliberately not
// JSON-in-cookie: four dot-delimited segments where the signable payload is the
// first three, HMAC-SHA256'd with the secret. deviceId is base64url (no '.'),
// issuedAt is decimal ms, so splitting on '.' is unambiguous.
const crypto = require('crypto');

const VERSION = 'v1';
const COOKIE_NAME = 'ar_auth';

// One shared lifetime for both server-side expiry enforcement (verify) and the
// Set-Cookie Max-Age, so the browser and the server can never disagree on when
// the credential dies. ~90 days.
const LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_AGE_SECONDS = Math.floor(LIFETIME_MS / 1000);

// Constant-time compare — a twin of auth.js's safeEqual (and board/lib.js's
// secretEqual), kept in sync by hand rather than shared-imported. A signature
// mismatch must not leak byte-by-byte via timing.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

// Mint a fresh signed cookie value with a new random device id. The device id is
// a forward-compat hook for the parked paired-device dashboard — minted from day
// one so existing cookies already carry it when that lands.
function issue(secret) {
  const deviceId = crypto.randomBytes(16).toString('base64url');
  const issuedAt = Date.now();
  const payload = `${VERSION}.${deviceId}.${issuedAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

// Verify a cookie value: recompute the signature (constant-time compare) and
// enforce expiry from the signed issued-at. Malformed values, bad signatures,
// wrong versions, non-numeric issued-ats, and expired issued-ats all return
// { ok: false, deviceId: null } — never throws.
function verify(value, secret) {
  const fail = { ok: false, deviceId: null };
  if (typeof value !== 'string') return fail;
  const parts = value.split('.');
  if (parts.length !== 4) return fail;
  const [version, deviceId, issuedAtRaw, sig] = parts;
  if (version !== VERSION) return fail;
  if (!deviceId) return fail;
  // Strict decimal parse — reject '', '12abc', '1.5', 'NaN', etc. that Number()
  // or parseInt would coerce.
  if (!/^\d+$/.test(issuedAtRaw)) return fail;
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isSafeInteger(issuedAt)) return fail;

  const payload = `${version}.${deviceId}.${issuedAtRaw}`;
  if (!safeEqual(sig, sign(payload, secret))) return fail;

  if (Date.now() - issuedAt > LIFETIME_MS) return fail;

  return { ok: true, deviceId };
}

// Full Set-Cookie header value. HttpOnly + SameSite=Strict + Path=/ + Max-Age
// always; Secure exactly when the caller says the request arrived over https
// (a Secure cookie over plain http would silently never be stored).
function setCookieHeader(value, { secure } = {}) {
  const attrs = [
    `${COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

// Hand-rolled Cookie request-header parse — extract this module's cookie by name
// without pulling in a dependency. Returns null when the header is absent or the
// cookie is not present.
function readAuthCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;
  for (const pair of cookieHeader.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    if (name === COOKIE_NAME) return pair.slice(eq + 1).trim();
  }
  return null;
}

module.exports = {
  issue,
  verify,
  setCookieHeader,
  readAuthCookie,
  COOKIE_NAME,
  LIFETIME_MS,
  MAX_AGE_SECONDS,
};
