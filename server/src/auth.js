const crypto = require('crypto');
const { loadCredentials } = require('./credentials');
const { verify: verifyCookie, readAuthCookie } = require('./cookie');

// Access-token policy — auth is ON by default. An unauthenticated relay is a
// command-execution endpoint for any page the operator's browser visits (see
// src/origin.js), so "AR_TOKEN unset" must not mean "open": it means a token is
// GENERATED for this run and printed at startup (index.js). AR_TOKEN pins a
// stable token instead; AR_NO_AUTH=1 is the explicit, dev-only opt-out.
// Pure so the three env shapes are unit-testable without subprocess env games.
//
// Retained as the non-persisted policy reference (and its own pinned test
// surface): TOKEN/TOKEN_GENERATED below no longer derive from this — they come
// from credentials.js's loadCredentials, which persists the generated case
// across restarts (ADR 0001 — an unstable token reads as a broken app) instead
// of minting a fresh one every run.
function resolveToken(env) {
  if (env.AR_NO_AUTH === '1') return { token: null, generated: false };
  if (env.AR_TOKEN) return { token: env.AR_TOKEN, generated: false };
  return { token: crypto.randomBytes(24).toString('base64url'), generated: true };
}

const {
  token: TOKEN,
  generated: TOKEN_GENERATED,
  signingSecret: SIGNING_SECRET,
} = loadCredentials(process.env);

// Constant-time compare so a network attacker can't recover the token byte by
// byte from response-time differences. Length is compared first (unavoidably
// non-constant on length, which leaks only the token's length, not its bytes);
// the byte comparison itself is constant-time via timingSafeEqual.
//
// Deliberately a twin of board/lib.js's secretEqual, not a shared import: this is
// the web tier's HTTP-token compare, that one is the board kernel's pipe-secret
// compare, and the board kernel is an independent package that runs standalone
// (sb / mcp-server) with no dependency on server/src. Keep the two in sync by
// hand — if you change the algorithm here, change it there too.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// token is injectable for tests; every real call site uses the module TOKEN.
function checkToken(candidate, token = TOKEN) {
  if (!token) return true; // auth explicitly disabled (AR_NO_AUTH=1)
  return safeEqual(candidate, token);
}

// The single "is this request authenticated?" decision, shared by the REST
// middleware and the WS upgrade gate so the two can't drift (a browser holds a
// cookie, not the raw token; a non-browser client holds only the token). Order
// is load-bearing: the bearer path (checkToken) is evaluated FIRST and exactly
// as before, so non-browser clients (VC-14) see byte-for-byte identical timing
// and behavior — the cookie is a *fallback* consulted only when the bearer path
// didn't already pass. Pure over its inputs (expectedToken/signingSecret are
// injectable, defaulting to the module credentials) so every path is unit-
// testable without env games or a live board.
function isAuthenticated({ token, cookieHeader, expectedToken = TOKEN, signingSecret = SIGNING_SECRET }) {
  if (!expectedToken) return true;            // auth explicitly disabled (AR_NO_AUTH=1)
  if (checkToken(token, expectedToken)) return true;  // bearer path — unchanged, checked first
  const cookieValue = readAuthCookie(cookieHeader);   // cookie fallback
  return !!(cookieValue && verifyCookie(cookieValue, signingSecret).ok);
}

// Factory so the middleware's credentials are injectable in tests (the module
// TOKEN/SIGNING_SECRET are derived from process.env + the persisted credentials
// file at load and aren't otherwise overridable). Real callers use the default
// instance `authMiddleware`, bound to the module credentials.
function makeAuthMiddleware({ expectedToken = TOKEN, signingSecret = SIGNING_SECRET } = {}) {
  return function authMiddleware(req, res, next) {
    const header = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (isAuthenticated({ token, cookieHeader: req.headers.cookie, expectedToken, signingSecret })) return next();
    return res.status(401).json({ error: 'unauthorized' });
  };
}

const authMiddleware = makeAuthMiddleware();

module.exports = {
  authMiddleware,
  makeAuthMiddleware,
  isAuthenticated,
  checkToken,
  resolveToken,
  TOKEN,
  TOKEN_GENERATED,
  SIGNING_SECRET,
};
