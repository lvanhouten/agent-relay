'use strict';
// Pluggable push sinks. The relay is pull-only (a blocked session can sit unseen
// for an hour), so /api/notify fans a caller-supplied message out here; callers
// (a Claude Code hook) decide WHEN, never the relay.
//
// Pushover is the only sink today: no VAPID/service worker/secure origin/tunnel
// needed, and it survives the office DNS filter that degrades Tailscale. Kept
// pluggable so a Web Push sink can join the same fan-out later.
//
// PAYLOAD DISCIPLINE: payloads transit Pushover's servers — keep them to "session
// <name> needs attention", NEVER session output, which can carry PHI/secrets.

const PUSHOVER_URL = 'https://api.pushover.net/1/messages.json';

// notify() resolves on success, rejects on a non-2xx or timeout; notifyAll()
// isolates that failure so one bad sink never blocks the caller (the free tier
// caps at 10k messages/month — a runaway hook must log, not crash the relay).
function pushoverNotifier({ token, user, fetchImpl = fetch, timeoutMs = 5000 }) {
  return {
    name: 'pushover',
    async notify({ title, body, url, priority } = {}) {
      const form = new URLSearchParams();
      form.set('token', token);
      form.set('user', user);
      form.set('message', (body || title || '').toString());
      if (title) form.set('title', title.toString());
      if (url) form.set('url', url.toString());
      if (priority != null) {
        form.set('priority', String(priority));
        // Pushover rejects priority 2 (repeat-until-ack) without retry+expire;
        // supply defaults so callers can just pass priority:2.
        if (Number(priority) === 2) {
          form.set('retry', '60');    // re-alert every 60s
          form.set('expire', '3600'); // give up after 1h
        }
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(PUSHOVER_URL, { method: 'POST', body: form, signal: ctrl.signal });
        if (!res.ok) throw new Error(`pushover responded ${res.status}`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// Absent config -> empty list -> the whole feature is silently off (notifyAll
// no-ops). Pure over its env arg (fetchImpl injectable) for testability. Token
// storage has the same inert Windows mode-bits caveat as the board secret file
// (see the secret-file ACL verification issue).
function resolveNotifiers(env = process.env, { fetchImpl = fetch } = {}) {
  const out = [];
  if (env.AR_PUSHOVER_TOKEN && env.AR_PUSHOVER_USER) {
    out.push(pushoverNotifier({ token: env.AR_PUSHOVER_TOKEN, user: env.AR_PUSHOVER_USER, fetchImpl }));
  }
  return out;
}

// Fans out concurrently; one sink's rejection is captured, never rethrown, so a
// fire-and-forget hook caller always gets a clean response. Each failure is also
// logged here — the caller never reads the response body, so this line is the
// only place a revoked token/rate limit/outage becomes visible.
async function notifyAll(notifiers, payload, { log = console.error } = {}) {
  const settled = await Promise.allSettled(notifiers.map((n) => n.notify(payload)));
  return settled.map((r, i) => {
    const name = notifiers[i].name;
    if (r.status === 'rejected') {
      const error = r.reason && r.reason.message ? r.reason.message : String(r.reason);
      log(`[notify] sink ${name} failed:`, error);
      return { name, ok: false, error };
    }
    return { name, ok: true };
  });
}

module.exports = { resolveNotifiers, notifyAll, pushoverNotifier, PUSHOVER_URL };
