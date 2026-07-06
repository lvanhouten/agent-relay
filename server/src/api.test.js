'use strict';
// api.js response-code routing tests. Verifies the board-unreachable contract
// end-to-end at the HTTP layer (new-W1 / C2): a down board is a 503 on POST and
// DELETE, a genuine "no such line" is a 404, and a non-board error still 500s via
// the error handler. Uses the real Express router with a fake sessions store.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');
const { createAPI } = require('./api');
const { BoardUnreachableError } = require('./sessions');
const { errorHandler } = require('./errorHandler');

function serve(sessions, notifiers = []) {
  const app = express();
  app.use(express.json());
  app.use('/api', createAPI(sessions, notifiers));
  // The real handler (index.js's own), not a duplicate — W3-new: a hand-rolled
  // copy here had drifted from index.js's actual fix and gave it zero coverage.
  app.use(errorHandler);
  return app;
}

function request(app, method, path, { contentType = 'application/json', body } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const sendBody = method === 'POST';
      const headers = sendBody ? { 'content-type': contentType } : {};
      const payload = body !== undefined ? JSON.stringify(body) : '{}';
      const req = http.request({ port, method, path, headers }, res => {
        let out = '';
        res.on('data', c => (out += c));
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: out }); });
      });
      req.on('error', e => { server.close(); reject(e); });
      req.end(sendBody ? payload : undefined);
    });
  });
}

const boardDown = { boardUnreachable: true };

test('POST /sessions -> 503 when spawn() throws BoardUnreachableError', async () => {
  const app = serve({ spawn: async () => { throw new BoardUnreachableError(); } });
  const { status } = await request(app, 'POST', '/api/sessions');
  assert.strictEqual(status, 503);
});

test('POST /sessions -> 415 on a non-JSON content type (a "simple" cross-site POST skips CORS preflight)', async () => {
  const app = serve({ spawn: async () => { throw new Error('spawn must not be reached'); } });
  const { status } = await request(app, 'POST', '/api/sessions', { contentType: 'text/plain' });
  assert.strictEqual(status, 415);
});

test('DELETE /sessions/:id -> 503 when kill() throws BoardUnreachableError (new-W1)', async () => {
  const app = serve({ kill: async () => { throw new BoardUnreachableError(); } });
  const { status } = await request(app, 'DELETE', '/api/sessions/7');
  assert.strictEqual(status, 503);
});

test('DELETE /sessions/:id -> 404 when kill() returns false (genuine not-found)', async () => {
  const app = serve({ kill: async () => false });
  const { status } = await request(app, 'DELETE', '/api/sessions/nope');
  assert.strictEqual(status, 404);
});

test('DELETE /sessions/:id -> 204 on a successful kill', async () => {
  const app = serve({ kill: async () => true });
  const { status } = await request(app, 'DELETE', '/api/sessions/7');
  assert.strictEqual(status, 204);
});

test('DELETE /sessions/:id -> 500 on a non-board error (not swallowed as 404)', async () => {
  const app = serve({ kill: async () => { throw new Error('boom'); } });
  const { status } = await request(app, 'DELETE', '/api/sessions/7');
  assert.strictEqual(status, 500);
});

// --- POST /notify: fan-out + needs-input flag ---

test('POST /notify -> 415 on a non-JSON content type (same cross-site guard as /sessions)', async () => {
  const app = serve({});
  const { status } = await request(app, 'POST', '/api/notify', { contentType: 'text/plain' });
  assert.strictEqual(status, 415);
});

test('POST /notify -> 400 when neither title nor body is present', async () => {
  const app = serve({});
  const { status } = await request(app, 'POST', '/api/notify', { body: { sessionId: '1' } });
  assert.strictEqual(status, 400);
});

test('POST /notify -> 400 on an out-of-range priority', async () => {
  const app = serve({});
  const { status } = await request(app, 'POST', '/api/notify', { body: { body: 'x', priority: 9 } });
  assert.strictEqual(status, 400);
});

test('POST /notify -> 200 and fans out to every sink', async () => {
  const seen = [];
  const notifier = { name: 'fake', notify: async (p) => { seen.push(p); } };
  const app = serve({}, [notifier]);
  const { status, body } = await request(app, 'POST', '/api/notify', {
    body: { title: 'api-dev', body: 'needs input', priority: 1 },
  });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(JSON.parse(body), { notified: [{ name: 'fake', ok: true }] });
  assert.deepStrictEqual(seen, [{ title: 'api-dev', body: 'needs input', url: undefined, priority: 1 }]);
});

test('POST /notify with needsInput+sessionId flags that session; omitting either does not', async () => {
  const flagged = [];
  const sessions = { flagAttention: (id) => flagged.push(id) };
  const app = serve(sessions);
  await request(app, 'POST', '/api/notify', { body: { sessionId: '7', body: 'x', needsInput: true } });
  await request(app, 'POST', '/api/notify', { body: { sessionId: '7', body: 'x' } });            // no needsInput
  await request(app, 'POST', '/api/notify', { body: { body: 'x', needsInput: true } });          // no sessionId
  assert.deepStrictEqual(flagged, ['7'], 'only the needsInput+sessionId call flags a session');
});

test('POST /notify -> 200 even when a sink fails (resilient; per-sink outcome reported)', async () => {
  const bad = { name: 'bad', notify: async () => { throw new Error('boom'); } };
  const app = serve({}, [bad]);
  const { status, body } = await request(app, 'POST', '/api/notify', { body: { body: 'x' } });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(JSON.parse(body), { notified: [{ name: 'bad', ok: false, error: 'boom' }] });
});

// Direct unit tests against the real handler (W3-new: the branch below had no
// coverage under either the old duplicate or the new shared version until now).
test('errorHandler: delegates to next(err) when headers are already sent, does not double-respond', () => {
  const err = new Error('boom');
  const calls = [];
  const res = {
    headersSent: true,
    status: () => { calls.push('status'); return res; },
    json: () => { calls.push('json'); },
  };
  const next = (e) => { calls.push('next'); assert.strictEqual(e, err); };
  errorHandler(err, {}, res, next);
  assert.deepStrictEqual(calls, ['next'], 'must delegate to next(err), never call status/json after headers are sent');
});

test('errorHandler: a board-unreachable error returns 503 with a generic body', () => {
  const err = Object.assign(new Error('down'), { boardUnreachable: true });
  let statusCode, body;
  const res = { headersSent: false, status: (c) => { statusCode = c; return res; }, json: (b) => { body = b; } };
  errorHandler(err, {}, res, () => assert.fail('next should not be called'));
  assert.strictEqual(statusCode, 503);
  assert.deepStrictEqual(body, { error: 'board unreachable' });
});

test('errorHandler: a non-board error returns a generic 500 with no internal detail leaked', () => {
  const err = new Error('sensitive stack detail');
  let statusCode, body;
  const res = { headersSent: false, status: (c) => { statusCode = c; return res; }, json: (b) => { body = b; } };
  errorHandler(err, {}, res, () => assert.fail('next should not be called'));
  assert.strictEqual(statusCode, 500);
  assert.deepStrictEqual(body, { error: 'internal error' });
});
