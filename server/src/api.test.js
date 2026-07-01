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

function serve(sessions) {
  const app = express();
  app.use(express.json());
  app.use('/api', createAPI(sessions));
  // Match index.js's final error handler (the non-boardUnreachable 500 path).
  app.use((err, req, res, _next) => {
    if (res.headersSent) return;
    err && err.boardUnreachable
      ? res.status(503).json({ error: 'board unreachable' })
      : res.status(500).json({ error: 'internal error' });
  });
  return app;
}

function request(app, method, path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const sendBody = method === 'POST';
      const headers = sendBody ? { 'content-type': 'application/json' } : {};
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
