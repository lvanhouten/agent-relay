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

function serve(sessions) {
  const app = express();
  app.use(express.json());
  app.use('/api', createAPI(sessions));
  // The real handler (index.js's own), not a duplicate — W3-new: a hand-rolled
  // copy here had drifted from index.js's actual fix and gave it zero coverage.
  app.use(errorHandler);
  return app;
}

function request(app, method, path, { contentType = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const sendBody = method === 'POST';
      const headers = sendBody ? { 'content-type': contentType } : {};
      const req = http.request({ port, method, path, headers }, res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body }); });
      });
      req.on('error', e => { server.close(); reject(e); });
      req.end(sendBody ? '{}' : undefined);
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
