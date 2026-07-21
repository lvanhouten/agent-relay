'use strict';
// Stateless HMAC-signed auth cookie — the browser's durable credential (always
// "auth cookie", never "session cookie": a session is a PTY line, not a browser
// identity). Pure: no I/O or process.env; the caller (credentials.js) passes in
// the signing secret, so it never touches disk here.
//
// Encoding is `v1.<deviceId>.<issuedAt>.<sig>`, not JSON: deviceId is base64url
// (no '.') and issuedAt is decimal ms, so splitting on '.' is unambiguous.
const crypto = require('crypto');
const { safeEqual } = require('./safeCompare');

const VERSION = 'v1';
const COOKIE_NAME = 'ar_auth';

// Shared by expiry enforcement (verify) and the Set-Cookie Max-Age so the
// browser and server can't disagree on when the credential dies (~90 days).
const LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_AGE_SECONDS = Math.floor(LIFETIME_MS / 1000);

// Constant-time compare comes from ./safeCompare (shared with auth.js) so a
// signature mismatch can't leak via timing and the two paths can't drift.

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

// Mints a signed cookie with a fresh device id — a forward-compat hook for the
// (parked) paired-device dashboard, present from day one so existing cookies
// already carry it.
function issue(secret) {
  const deviceId = crypto.randomBytes(16).toString('base64url');
  const issuedAt = Date.now();
  const payload = `${VERSION}.${deviceId}.${issuedAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

// Recomputes the signature (constant-time) and enforces expiry from the signed
// issued-at. Malformed/bad-signature/wrong-version/non-numeric/expired all
// return { ok: false, deviceId: null } — never throws.
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

// HttpOnly + SameSite=Strict + Path=/ + Max-Age always; Secure only when the
// caller says the request arrived over https (else it'd silently never be stored).
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

// Hand-rolled Cookie-header parse (no dependency) — returns null if the header
// or this cookie is absent.
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
