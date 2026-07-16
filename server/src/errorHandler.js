'use strict';
// Final Express error handler, factored out so api.test.js exercises the real
// implementation instead of a hand-rolled duplicate that could drift from it.
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity (4 args)
function errorHandler(err, req, res, next) {
  console.error('[api] unhandled route error:', err && err.stack ? err.stack : err);
  // If the response is already streaming, we can't set a status/body — Express's
  // documented pattern is to delegate to the default handler via next(err), which
  // aborts the connection, rather than bare-return (which would leave a
  // half-written response hanging).
  if (res.headersSent) return next(err);
  if (err && err.boardUnreachable) { res.status(503).json({ error: 'board unreachable' }); return; }
  res.status(500).json({ error: 'internal error' });
}

module.exports = { errorHandler };
