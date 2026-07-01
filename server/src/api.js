'use strict';
const { Router } = require('express');

// REST over the board-backed session store. Handlers are async because every
// operation is an RPC to the board kernel; errors propagate to Express via next().
function createAPI(sessions) {
  const r = Router();

  // A board-unreachable failure is a transient 503, not a 500 — the board is a
  // separate process that restarts (autostart, code changes) as normal operation.
  r.get('/sessions', async (_req, res, next) => {
    try { res.json(await sessions.list()); }
    catch (e) { e.boardUnreachable ? res.status(503).json({ error: 'board unreachable' }) : next(e); }
  });

  r.post('/sessions', async (req, res, next) => {
    try {
      const { name, cwd, shell, command } = req.body ?? {};
      res.status(201).json(await sessions.spawn({ name, cwd, shell, command }));
    } catch (e) { next(e); }
  });

  r.get('/sessions/:id', async (req, res, next) => {
    try {
      const s = await sessions.get(req.params.id);
      s ? res.json(s) : res.status(404).json({ error: 'not found' });
    } catch (e) { e.boardUnreachable ? res.status(503).json({ error: 'board unreachable' }) : next(e); }
  });

  r.delete('/sessions/:id', async (req, res, next) => {
    try {
      (await sessions.kill(req.params.id))
        ? res.status(204).end()
        : res.status(404).json({ error: 'not found' });
    } catch (e) { next(e); }
  });

  return r;
}

module.exports = { createAPI };
