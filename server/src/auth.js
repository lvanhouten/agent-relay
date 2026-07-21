const crypto = require('crypto');
const { loadCredentials } = require('./credentials');
const { verify: verifyCookie, readAuthCookie } = require('./cookie');
const { safeEqual } = require('./safeCompare');

// Auth-on-by-default policy: AR_NO_AUTH=1 disables it, AR_TOKEN pins a stable
// token, otherwise one is generated. Pure/testable, but NOT on the production
// path — the real TOKEN comes from credentials.js's loadCredentials (which
// persists the generated token across restarts); read that, not this, for live behavior.
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

// Constant-time compare lives in ./safeCompare (shared with cookie.js so the two
// can't drift); board/lib.js's secretEqual is a separate hand-synced twin.

// token is injectable for tests; every real call site uses the module TOKEN.
function checkToken(candidate, token = TOKEN) {
  if (!token) return true; // auth explicitly disabled (AR_NO_AUTH=1)
  return safeEqual(candidate, token);
}

// Shared REST/WS auth decision (browsers hold a cookie, non-browser clients hold
// the token). Order is load-bearing: bearer (checkToken) is tried FIRST so
// non-browser timing/behavior stays identical; the cookie is only a fallback.
function isAuthenticated({ token, cookieHeader, expectedToken = TOKEN, signingSecret = SIGNING_SECRET }) {
  if (!expectedToken) return true;            // auth explicitly disabled (AR_NO_AUTH=1)
  if (checkToken(token, expectedToken)) return true;  // bearer path, checked first
  const cookieValue = readAuthCookie(cookieHeader);   // cookie fallback
  return !!(cookieValue && verifyCookie(cookieValue, signingSecret).ok);
}

// Factory so credentials are injectable in tests; real callers use the default
// `authMiddleware`, bound to the module TOKEN/SIGNING_SECRET.
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
