const crypto = require('crypto');

const TOKEN = process.env.AR_TOKEN;

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

function checkToken(candidate) {
  if (!TOKEN) return true; // auth disabled when AR_TOKEN is unset
  return safeEqual(candidate, TOKEN);
}

function authMiddleware(req, res, next) {
  if (!TOKEN) return next();
  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!checkToken(token)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

module.exports = { authMiddleware, checkToken };
