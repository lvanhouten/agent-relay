const crypto = require('crypto');

// Access-token policy — auth is ON by default. An unauthenticated relay is a
// command-execution endpoint for any page the operator's browser visits (see
// src/origin.js), so "AR_TOKEN unset" must not mean "open": it means a token is
// GENERATED for this run and printed at startup (index.js). AR_TOKEN pins a
// stable token instead; AR_NO_AUTH=1 is the explicit, dev-only opt-out.
// Pure so the three env shapes are unit-testable without subprocess env games.
function resolveToken(env) {
  if (env.AR_NO_AUTH === '1') return { token: null, generated: false };
  if (env.AR_TOKEN) return { token: env.AR_TOKEN, generated: false };
  return { token: crypto.randomBytes(24).toString('base64url'), generated: true };
}

const { token: TOKEN, generated: TOKEN_GENERATED } = resolveToken(process.env);

// Constant-time compare so a network attacker can't recover the token byte by
// byte from response-time differences. Length is compared first (unavoidably
// non-constant on length, which leaks only the token's length, not its bytes);
// the byte comparison itself is constant-time via timingSafeEqual.
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

module.exports = { authMiddleware, checkToken, resolveToken, TOKEN, TOKEN_GENERATED };
