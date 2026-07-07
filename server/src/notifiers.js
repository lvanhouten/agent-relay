'use strict';
// Pluggable push-notification sinks. The relay is pull-only, so a session can
// sit blocked on a prompt for an hour while the operator's phone is locked;
// `/api/notify` (api.js) fans a caller-supplied message out to every configured
// sink here. Deliberately dumb: the relay never decides WHEN to notify, callers
// (a Claude Code Notification/Stop hook) do — see the README hook recipe.
//
// Pushover is the first (and, today, only) sink because it sidesteps the entire
// Web Push dependency chain — no VAPID, no service worker, no secure origin, no
// tunnel: the relay makes one outbound HTTPS POST and Pushover's own app renders
// the notification on the phone. Crucially it survives the office DNS filter that
// degrades Tailscale (see _docs/issues/2026-07-06-pushover-notification-channel.md).
// The seam stays pluggable so a Web Push sink can hang off the same fan-out later
// without touching callers.
//
// PAYLOAD DISCIPLINE: payloads transit Pushover's servers. Callers must keep them
// to "session <name> needs attention" — NEVER session output, which can carry
// PHI/secrets given what runs in these shells.

const PUSHOVER_URL = 'https://api.pushover.net/1/messages.json';

// A Pushover sink. `notify` resolves on success and REJECTS on a non-2xx or a
// timeout — notifyAll() isolates that failure so one bad sink never blocks the
// caller (the free tier caps at 10k messages/month; a runaway hook must not
// crash the relay, just log).
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
        // priority 2 (repeat until acknowledged) is rejected by Pushover unless
        // it carries retry+expire. Supply sane defaults so a caller can ask for
        // "keep buzzing until I look" with just priority:2.
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

// Build the sink list from env. Absent config -> empty list -> the whole feature
// is silently off (notifyAll is a no-op), exactly as the issue doc specifies.
// Pure over its env arg (fetchImpl injectable) so the resolution is unit-testable
// without env games or a live network. Token storage carries the same inert-mode
// -bits Windows caveat as the board secret file (2026-07-01-secret-file-acl).
function resolveNotifiers(env = process.env, { fetchImpl = fetch } = {}) {
  const out = [];
  if (env.AR_PUSHOVER_TOKEN && env.AR_PUSHOVER_USER) {
    out.push(pushoverNotifier({ token: env.AR_PUSHOVER_TOKEN, user: env.AR_PUSHOVER_USER, fetchImpl }));
  }
  return out;
}

// Fan a payload out to every sink concurrently. One sink's rejection is captured,
// never rethrown — the caller (a hook curl) always gets a clean response. Each
// failure is ALSO logged here, not just returned: the documented caller is a
// fire-and-forget hook that never reads the response body, so this log line is
// the only place a revoked token / rate limit / outage is visible at all.
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
