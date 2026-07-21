'use strict';
// Factored out so api.test.js exercises the real handler instead of a
// hand-rolled duplicate that could drift.
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity (4 args)
function errorHandler(err, req, res, next) {
  console.error('[api] unhandled route error:', err && err.stack ? err.stack : err);
  // Response already streaming -> can't set status/body; delegate to next(err)
  // (Express's documented pattern) rather than bare-return, which would leave a
  // half-written response hanging.
  if (res.headersSent) return next(err);
  if (err && err.boardUnreachable) { res.status(503).json({ error: 'board unreachable' }); return; }
  res.status(500).json({ error: 'internal error' });
}

module.exports = { errorHandler };
