'use strict';
const { Router } = require('express');
const { notifyAll } = require('./notifiers');
const { browseDir } = require('./fsBrowse');

// These fields flow into pty.spawn (`command` is typed into a real shell), so
// validate type + length here rather than let a non-string throw opaquely inside
// resolveCwd/pty.spawn, or a multi-MB payload reach a live shell.
const FIELD_MAX = { name: 200, cwd: 4096, shell: 500, command: 8192 };

// Every field is optional, but any present one must be a string within its cap.
// One shared loop for every validated body so a fix reaches all of them at once.
function validateFieldCaps(body, caps) {
  for (const [field, max] of Object.entries(caps)) {
    const v = body[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') return `${field} must be a string`;
    if (v.length > max) return `${field} exceeds the ${max}-character limit`;
  }
  return null;
}

function validateSpawnBody(body) {
  return validateFieldCaps(body, FIELD_MAX);
}

// title/body transit a third-party push service (see notifiers.js's payload-
// discipline note), so bound them here too.
const NOTIFY_MAX = { sessionId: 200, cwd: 4096, title: 200, body: 1000, url: 2048 };

// title or body required (an empty notification is pointless); priority, if
// given, must be a Pushover-valid integer in [-2, 2].
function validateNotifyBody(body) {
  const capError = validateFieldCaps(body, NOTIFY_MAX);
  if (capError) return capError;
  if (!body.title && !body.body) return 'title or body is required';
  if (body.priority !== undefined && body.priority !== null) {
    if (typeof body.priority !== 'number' || !Number.isInteger(body.priority) || body.priority < -2 || body.priority > 2) {
      return 'priority must be an integer in [-2, 2]';
    }
  }
  if (body.needsInput !== undefined && typeof body.needsInput !== 'boolean') return 'needsInput must be a boolean';
  return null;
}

// All optional strings; a valid `event` is the only requirement. SECURITY:
// transcriptPath is only length-capped here, not canonicalized/allow-listed, and
// is attacker-suppliable — see the SECURITY note on `_beacons` in sessions.js
// before any future consumer reads it.
const BEACON_MAX = { sessionId: 200, claudeSessionId: 200, transcriptPath: 4096, cwd: 4096 };
const BEACON_EVENTS = new Set(['SessionStart', 'Stop', 'SessionEnd']);

// `event` must be one of the three recognized lifecycle events. No title/body —
// a beacon never pushes.
function validateBeaconBody(body) {
  const capError = validateFieldCaps(body, BEACON_MAX);
  if (capError) return capError;
  if (!BEACON_EVENTS.has(body.event)) return 'event must be one of SessionStart, Stop, SessionEnd';
  return null;
}

// `url` becomes a tap-through link in a TRUSTED push notification — a phishing
// surface unique to this field. Default-deny: rejected unless AR_NOTIFY_URL_ORIGIN
// names the one allowed origin, compared as parsed origins (not a string prefix)
// so a lookalike subdomain can't ride a prefix match.
// This only holds while the relay origin has no attacker-steerable redirect — if
// a return_to/OAuth-callback endpoint is ever added, pin an allowed path prefix here too.
function validateNotifyUrl(url, allowedOrigin) {
  if (url === undefined || url === null) return null;
  if (!allowedOrigin) return 'url is disabled (set AR_NOTIFY_URL_ORIGIN to enable deep links)';
  let allowed;
  try { allowed = new URL(allowedOrigin).origin; } catch { return 'url is disabled (AR_NOTIFY_URL_ORIGIN is not a valid origin)'; }
  let parsed;
  try { parsed = new URL(url); } catch { return 'url must be an absolute URL'; }
  if (parsed.origin !== allowed) return `url must be on ${allowed}`;
  return null;
}

// REST over the board-backed session store. Handlers are async since every op is
// an RPC to the board; errors propagate to Express via next(). An empty `notifiers`
// list makes POST /notify a no-op fan-out (feature off) while still flagging the card.
function createAPI(sessions, notifiers = [], { notifyUrlOrigin } = {}) {
  const r = Router();

  // A board-unreachable failure is a transient 503, not a 500 — the board
  // restarts (autostart, code changes) as normal operation.
  r.get('/sessions', async (_req, res, next) => {
    try { res.json(await sessions.list()); }
    catch (e) { e.boardUnreachable ? res.status(503).json({ error: 'board unreachable' }) : next(e); }
  });

  r.post('/sessions', async (req, res, next) => {
    try {
      // JSON-only: a cross-site text/plain POST skips the CORS preflight; without
      // this, express.json() leaves req.body empty and a default shell spawns as
      // a side effect. Applies even under AR_NO_AUTH=1.
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

  // Fans a notification to every configured sink and, if `needsInput`, flags the
  // session's card — by `sessionId` (exact, via the board-injected
  // AGENT_RELAY_SESSION) or, failing that, by matching `cwd` against live lines.
  // Shared plumbing for a Claude Code hook: one POST both buzzes the phone and
  // answers "which session needs me?" on the dashboard. Same 415 JSON guard as
  // POST /sessions; an unmatched id/cwd just flags nothing; a sink failure is
  // captured, never fatal (notifyAll).
  r.post('/notify', async (req, res, next) => {
    try {
      if (!req.is('json')) return res.status(415).json({ error: 'expected application/json' });
      const body = req.body ?? {};
      const invalid = validateNotifyBody(body) ?? validateNotifyUrl(body.url, notifyUrlOrigin);
      if (invalid) return res.status(400).json({ error: invalid });
      if (body.needsInput) {
        if (body.sessionId) sessions.flagAttention(body.sessionId);
        else if (body.cwd) await sessions.flagAttentionByCwd(body.cwd);
      }
      const notified = await notifyAll(notifiers, {
        title: body.title, body: body.body, url: body.url, priority: body.priority,
      });
      res.json({ notified });
    } catch (e) { e.boardUnreachable ? res.status(503).json({ error: 'board unreachable' }) : next(e); }
  });

  // Applies a Claude Code lifecycle beacon (SessionStart/Stop/SessionEnd) to give
  // Claude lines an honest attention state. Unlike /notify this NEVER pushes — pure
  // state. Target resolution mirrors /notify (sessionId, else cwd). Same 415 JSON
  // guard; a board-down beacon is a transient 503, not a 500.
  r.post('/beacon', async (req, res, next) => {
    try {
      if (!req.is('json')) return res.status(415).json({ error: 'expected application/json' });
      const body = req.body ?? {};
      const invalid = validateBeaconBody(body);
      if (invalid) return res.status(400).json({ error: invalid });
      const id = await sessions.beacon({
        event: body.event,
        sessionId: body.sessionId,
        claudeSessionId: body.claudeSessionId,
        transcriptPath: body.transcriptPath,
        cwd: body.cwd,
      });
      res.json({ ok: true, id: id ?? null });
    } catch (e) { e.boardUnreachable ? res.status(503).json({ error: 'board unreachable' }) : next(e); }
  });

  // Read-only directory listing for the create dialog's "Browse…" picker, over
  // the BOARD's filesystem (see fsBrowse.js). No board RPC, so no 503 path;
  // filesystem errors map to typed 4xx (denied -> 403, missing/not-a-dir -> 400).
  r.get('/fs/browse', async (req, res, next) => {
    try {
      // Express parses a repeated ?path= into an array; coerce so a malformed
      // query resolves to home (undefined) rather than throwing in resolveCwd.
      const p = typeof req.query.path === 'string' ? req.query.path : undefined;
      const result = await browseDir(p);
      if (result.error) {
        return res.status(result.error === 'denied' ? 403 : 400).json(result);
      }
      res.json(result);
    } catch (e) { next(e); }
  });

  return r;
}

module.exports = { createAPI };
