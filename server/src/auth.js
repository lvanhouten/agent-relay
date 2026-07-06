const crypto = require('crypto');
const { loadCredentials } = require('./credentials');

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

function authMiddleware(req, res, next) {
  if (!TOKEN) return next();
  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!checkToken(token)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

module.exports = { authMiddleware, checkToken, resolveToken, TOKEN, TOKEN_GENERATED, SIGNING_SECRET };
