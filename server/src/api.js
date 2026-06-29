const { Router } = require('express');

function createAPI(sessions) {
  const r = Router();

  r.get('/sessions', (_req, res) => res.json(sessions.list()));

  r.post('/sessions', (req, res) => {
    const { name, cwd, shell, command } = req.body ?? {};
    const session = sessions.spawn({ name, cwd, shell, command });
    res.status(201).json(session);
  });

  r.get('/sessions/:id', (req, res) => {
    const s = sessions.get(req.params.id);
    s ? res.json(s) : res.status(404).json({ error: 'not found' });
  });

  r.delete('/sessions/:id', (req, res) => {
    sessions.kill(req.params.id)
      ? res.status(204).end()
      : res.status(404).json({ error: 'not found' });
  });

  return r;
}

module.exports = { createAPI };
