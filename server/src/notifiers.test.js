'use strict';
// Env-driven sink resolution, Pushover payload shaping, and fan-out
// resilience (one sink's failure never blocks the others) — via an
// injected fetch, no network or real Pushover keys.
const test = require('node:test');
const assert = require('node:assert');
const { resolveNotifiers, notifyAll, pushoverNotifier, PUSHOVER_URL } = require('./notifiers');

const okFetch = () => Promise.resolve({ ok: true, status: 200 });

test('resolveNotifiers: no Pushover env -> empty list (feature off)', () => {
  assert.deepStrictEqual(resolveNotifiers({}), []);
  // One key without the other is still off — both are required.
  assert.deepStrictEqual(resolveNotifiers({ AR_PUSHOVER_TOKEN: 't' }), []);
  assert.deepStrictEqual(resolveNotifiers({ AR_PUSHOVER_USER: 'u' }), []);
});

test('resolveNotifiers: both keys -> one pushover sink', () => {
  const ns = resolveNotifiers({ AR_PUSHOVER_TOKEN: 't', AR_PUSHOVER_USER: 'u' }, { fetchImpl: okFetch });
  assert.strictEqual(ns.length, 1);
  assert.strictEqual(ns[0].name, 'pushover');
});

test('pushover notify: posts token/user/message to the Pushover endpoint', async () => {
  let captured;
  const fetchImpl = (url, opts) => { captured = { url, opts }; return okFetch(); };
  const n = pushoverNotifier({ token: 'tok', user: 'usr', fetchImpl });
  await n.notify({ title: 'Session api-dev', body: 'needs your input' });
  assert.strictEqual(captured.url, PUSHOVER_URL);
  assert.strictEqual(captured.opts.method, 'POST');
  const form = captured.opts.body; // URLSearchParams
  assert.strictEqual(form.get('token'), 'tok');
  assert.strictEqual(form.get('user'), 'usr');
  assert.strictEqual(form.get('title'), 'Session api-dev');
  assert.strictEqual(form.get('message'), 'needs your input');
});

test('pushover notify: body falls back to title when body is absent', async () => {
  let form;
  const fetchImpl = (_url, opts) => { form = opts.body; return okFetch(); };
  await pushoverNotifier({ token: 't', user: 'u', fetchImpl }).notify({ title: 'only a title' });
  assert.strictEqual(form.get('message'), 'only a title');
});

test('pushover notify: priority 2 auto-supplies retry+expire (Pushover 400s without them)', async () => {
  let form;
  const fetchImpl = (_url, opts) => { form = opts.body; return okFetch(); };
  await pushoverNotifier({ token: 't', user: 'u', fetchImpl }).notify({ body: 'blocked', priority: 2 });
  assert.strictEqual(form.get('priority'), '2');
  assert.strictEqual(form.get('retry'), '60');
  assert.strictEqual(form.get('expire'), '3600');
});

test('pushover notify: a lower priority carries no retry/expire', async () => {
  let form;
  const fetchImpl = (_url, opts) => { form = opts.body; return okFetch(); };
  await pushoverNotifier({ token: 't', user: 'u', fetchImpl }).notify({ body: 'x', priority: 1 });
  assert.strictEqual(form.get('priority'), '1');
  assert.strictEqual(form.get('retry'), null);
  assert.strictEqual(form.get('expire'), null);
});

test('pushover notify: a non-2xx response rejects', async () => {
  const fetchImpl = () => Promise.resolve({ ok: false, status: 429 });
  await assert.rejects(
    () => pushoverNotifier({ token: 't', user: 'u', fetchImpl }).notify({ body: 'x' }),
    /pushover responded 429/,
  );
});

test('notifyAll: one sink failing never blocks the others, and reports per-sink outcome', async () => {
  const good = { name: 'good', notify: async () => {} };
  const bad = { name: 'bad', notify: async () => { throw new Error('boom'); } };
  const results = await notifyAll([good, bad], { body: 'hi' });
  assert.deepStrictEqual(results, [
    { name: 'good', ok: true },
    { name: 'bad', ok: false, error: 'boom' },
  ]);
});

test('notifyAll: a failing sink is logged server-side, not only reported in the response', async () => {
  // The caller is a fire-and-forget hook curl that never reads the response
  // body — the log line is the only visible trace of a broken sink.
  const logged = [];
  const bad = { name: 'bad', notify: async () => { throw new Error('pushover responded 429'); } };
  await notifyAll([bad], { body: 'hi' }, { log: (...args) => logged.push(args.join(' ')) });
  assert.strictEqual(logged.length, 1);
  assert.match(logged[0], /\[notify\] sink bad failed:.*pushover responded 429/);
});

test('notifyAll: successful sinks log nothing', async () => {
  const logged = [];
  const good = { name: 'good', notify: async () => {} };
  await notifyAll([good], { body: 'hi' }, { log: (...args) => logged.push(args.join(' ')) });
  assert.strictEqual(logged.length, 0);
});

test('notifyAll: empty sink list is a clean no-op', async () => {
  assert.deepStrictEqual(await notifyAll([], { body: 'hi' }), []);
});
