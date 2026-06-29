const TOKEN = process.env.AR_TOKEN;

function checkToken(candidate) {
  if (!TOKEN) return true; // auth disabled when AR_TOKEN is unset
  return candidate === TOKEN;
}

function authMiddleware(req, res, next) {
  if (!TOKEN) return next();
  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!checkToken(token)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

module.exports = { authMiddleware, checkToken };
