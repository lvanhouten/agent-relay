'use strict';
const { Router } = require('express');
const { notifyAll } = require('./notifiers');

// Field caps for POST /sessions. These fields flow into pty.spawn (and `command`
// is typed into a real shell), so validate type + length here rather than let a
// non-string throw opaquely inside resolveCwd/pty.spawn, or a multi-MB payload
// reach a live shell.
const FIELD_MAX = { name: 200, cwd: 4096, shell: 500, command: 8192 };

// Shared type+length check over a cap table. Every field is optional, but any
// present one must be a string within its cap. Returns an error string, or null
// if valid. One loop for every validated body (spawn, notify, and /api/templates
// when phase 2 lands) so a fix to the check can't land in one copy and not the
// other; each endpoint layers its extra rules on top.
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

// Field caps for POST /notify. title/body transit a third-party push service, so
// bound them here; the notifier module also enforces payload discipline in prose.
const NOTIFY_MAX = { sessionId: 200, cwd: 4096, title: 200, body: 1000, url: 2048 };

// Validate POST /notify. Returns an error string, or null if valid. title or
// body must be present (an empty notification is pointless); priority, if given,
// must be a Pushover-valid integer in [-2, 2]; needsInput, if given, a boolean.
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

// Field caps for POST /beacon. All optional strings; presence of a valid `event`
// is the only requirement. sessionId/claudeSessionId are ids; transcriptPath/cwd
// are filesystem paths (capped like `cwd` on the other endpoints).
const BEACON_MAX = { sessionId: 200, claudeSessionId: 200, transcriptPath: 4096, cwd: 4096 };
const BEACON_EVENTS = new Set(['SessionStart', 'Stop', 'SessionEnd']);

// Validate POST /beacon. Returns an error string, or null if valid. `event` must
// be one of the three recognized lifecycle events; every other field is an
// optional capped string (validateFieldCaps). No title/body — a beacon never
// pushes, so it carries none.
function validateBeaconBody(body) {
  const capError = validateFieldCaps(body, BEACON_MAX);
  if (capError) return capError;
  if (!BEACON_EVENTS.has(body.event)) return 'event must be one of SessionStart, Stop, SessionEnd';
  return null;
}

// `url` renders as a tap-through deep link inside a TRUSTED push notification
// on the operator's phone — a phishing surface nothing else on this API has
// (ADR-0001's accepted XSS ceiling covers local shell spawn, not off-device
// credential harvesting from a notification tapped days later). Default-deny:
// the field is rejected unless AR_NOTIFY_URL_ORIGIN names the one allowed
// origin (set it to the origin you load the relay from). Compared as parsed
// origins, not a string prefix, so https://relay.example.evil.com can't ride
// a prefix match on https://relay.example.
// Standing dependency: this closes the off-device vector only while the relay
// origin itself has no attacker-steerable redirect. If a return_to/OAuth-
// callback style endpoint is ever added, a deep link could bounce through the
// trusted origin onward — pin an allowed path prefix here at that point.
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

// REST over the board-backed session store. Handlers are async because every
// operation is an RPC to the board kernel; errors propagate to Express via next().
// `notifiers` is the resolved push-sink list (notifiers.js); an empty list makes
// POST /notify a no-op fan-out (feature off) while still flagging the card.
function createAPI(sessions, notifiers = [], { notifyUrlOrigin } = {}) {
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
  // when `needsInput` is set, light the session's card (needs-input attention
  // state). The session is named by `sessionId` (exact — the board injects
  // AGENT_RELAY_SESSION into every spawned line) or, failing that, resolved from
  // `cwd` by matching the board's live lines (the fallback for a hook that knows
  // its directory but not the line id). Shared plumbing for a Claude Code hook:
  // one POST both buzzes the phone (Pushover) and answers "which session needs
  // me?" on the dashboard. Same 415 JSON-content-type guard as POST /sessions — a
  // cross-site text/plain POST skips the CORS preflight. A gone/unknown sessionId
  // or unmatched cwd just doesn't flag anything (the flag is pruned on the next
  // list); a sink failure is captured, never fatal (notifyAll).
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

  // Apply a Claude Code lifecycle beacon (SessionStart / Stop / SessionEnd) to the
  // session store, giving Claude lines an honest attention state on their card.
  // Unlike /notify this NEVER pushes — a beacon carries no title/body and does not
  // touch the notifier sinks; it is pure state. Target resolution mirrors /notify:
  // `sessionId` (exact — the board injects AGENT_RELAY_SESSION) or, absent that,
  // `cwd` matched against the board's live lines. Same 415 JSON-content-type guard
  // as /sessions and /notify (a cross-site text/plain POST skips CORS preflight); a
  // board-down beacon is a transient 503, not a 500.
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

  return r;
}

module.exports = { createAPI };
