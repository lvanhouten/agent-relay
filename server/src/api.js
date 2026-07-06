'use strict';
const { Router } = require('express');
const { notifyAll } = require('./notifiers');

// Field caps for POST /sessions. These fields flow into pty.spawn (and `command`
// is typed into a real shell), so validate type + length here rather than let a
// non-string throw opaquely inside resolveCwd/pty.spawn, or a multi-MB payload
// reach a live shell.
const FIELD_MAX = { name: 200, cwd: 4096, shell: 500, command: 8192 };

// Every field is optional, but any present one must be a string within its cap.
// Returns an error string, or null if valid.
function validateSpawnBody(body) {
  for (const [field, max] of Object.entries(FIELD_MAX)) {
    const v = body[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') return `${field} must be a string`;
    if (v.length > max) return `${field} exceeds the ${max}-character limit`;
  }
  return null;
}

// Field caps for POST /notify. title/body transit a third-party push service, so
// bound them here; the notifier module also enforces payload discipline in prose.
const NOTIFY_MAX = { sessionId: 200, title: 200, body: 1000, url: 2048 };

// Validate POST /notify. Returns an error string, or null if valid. title or
// body must be present (an empty notification is pointless); priority, if given,
// must be a Pushover-valid integer in [-2, 2]; needsInput, if given, a boolean.
function validateNotifyBody(body) {
  for (const [field, max] of Object.entries(NOTIFY_MAX)) {
    const v = body[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') return `${field} must be a string`;
    if (v.length > max) return `${field} exceeds the ${max}-character limit`;
  }
  if (!body.title && !body.body) return 'title or body is required';
  if (body.priority !== undefined && body.priority !== null) {
    if (typeof body.priority !== 'number' || !Number.isInteger(body.priority) || body.priority < -2 || body.priority > 2) {
      return 'priority must be an integer in [-2, 2]';
    }
  }
  if (body.needsInput !== undefined && typeof body.needsInput !== 'boolean') return 'needsInput must be a boolean';
  return null;
}

// REST over the board-backed session store. Handlers are async because every
// operation is an RPC to the board kernel; errors propagate to Express via next().
// `notifiers` is the resolved push-sink list (notifiers.js); an empty list makes
// POST /notify a no-op fan-out (feature off) while still flagging the card.
function createAPI(sessions, notifiers = []) {
  const r = Router();

  // A board-unreachable failure is a transient 503, not a 500 — the board is a
  // separate process that restarts (autostart, code changes) as normal operation.
  r.get('/sessions', async (_req, res, next) => {
    try { res.json(await sessions.list()); }
    catch (e) { e.boardUnreachable ? res.status(503).json({ error: 'board unreachable' }) : next(e); }
  });

  r.post('/sessions', async (req, res, next) => {
    try {
      // Require a JSON content type. A cross-site page can fire a "simple"
      // text/plain POST that skips the CORS preflight entirely; express.json()
      // would leave req.body empty and this handler would spawn a default
      // shell as a side effect. 415 closes that channel even under AR_NO_AUTH=1.
      if (!req.is('json')) return res.status(415).json({ error: 'expected application/json' });
      const body = req.body ?? {};
      const invalid = validateSpawnBody(body);
      if (invalid) return res.status(400).json({ error: invalid });
      const { name, cwd, shell, command } = body;
      res.status(201).json(await sessions.spawn({ name, cwd, shell, command }));
    } catch (e) { e.boardUnreachable ? res.status(503).json({ error: 'board unreachable' }) : next(e); }
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
    } catch (e) { e.boardUnreachable ? res.status(503).json({ error: 'board unreachable' }) : next(e); }
  });

  // Fan a caller-supplied notification out to every configured push sink and,
  // when `needsInput` is set with a `sessionId`, light that session's card
  // (needs-input attention state). Shared plumbing for a Claude Code hook: one
  // POST both buzzes the phone (Pushover) and answers "which session needs me?"
  // on the dashboard. Same 415 JSON-content-type guard as POST /sessions — a
  // cross-site text/plain POST skips the CORS preflight. A gone/unknown sessionId
  // just doesn't flag anything (the flag is pruned on the next list); a sink
  // failure is captured, never fatal (notifyAll).
  r.post('/notify', async (req, res, next) => {
    try {
      if (!req.is('json')) return res.status(415).json({ error: 'expected application/json' });
      const body = req.body ?? {};
      const invalid = validateNotifyBody(body);
      if (invalid) return res.status(400).json({ error: invalid });
      if (body.needsInput && body.sessionId) sessions.flagAttention(body.sessionId);
      const notified = await notifyAll(notifiers, {
        title: body.title, body: body.body, url: body.url, priority: body.priority,
      });
      res.json({ notified });
    } catch (e) { e.boardUnreachable ? res.status(503).json({ error: 'board unreachable' }) : next(e); }
  });

  return r;
}

module.exports = { createAPI };
