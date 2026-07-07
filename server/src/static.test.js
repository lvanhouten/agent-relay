'use strict';
// static.js contract tests against a fixture dist dir: real files serve with the
// right cache headers, unknown paths fall back to index.html (SPA), and the
// fallback never shadows /api or /sessions — an unknown API path must stay an
// API 404, not silently become the login page.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { createStatic } = require('./static');

function makeDist(t) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-static-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<html>relay-index</html>');
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'assets', 'app.abc123.js'), 'console.log("app")');
  // A sibling of dist that must never be reachable through it.
  fs.writeFileSync(path.join(path.dirname(dist), 'ar-static-outside.txt'), 'secret');
  t.after(() => {
    fs.rmSync(dist, { recursive: true });
    fs.rmSync(path.join(path.dirname(dist), 'ar-static-outside.txt'), { force: true });
  });
  return dist;
}

// Mirrors index.js's mount order: /api first, static after, so the tests prove
// the composed behavior, not the router in isolation.
function serve(dist) {
  const app = express();
  app.get('/api/known', (req, res) => res.json({ ok: true }));
  app.use(createStatic(dist));
  return app;
}

function request(app, method, rawPath) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request({ port, method, path: rawPath }, res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, headers: res.headers, body }); });
      });
      req.on('error', e => { server.close(); reject(e); });
      req.end();
    });
  });
}

test('createStatic -> null when there is no build (no index.html)', () => {
  assert.strictEqual(createStatic(path.join(os.tmpdir(), 'ar-static-does-not-exist')), null);
});

test('GET / serves index.html with no-cache', async t => {
  const { status, headers, body } = await request(serve(makeDist(t)), 'GET', '/');
  assert.strictEqual(status, 200);
  assert.match(body, /relay-index/);
  assert.strictEqual(headers['cache-control'], 'no-cache');
});

test('GET /assets/<hashed> serves with an immutable cache header', async t => {
  const { status, headers } = await request(serve(makeDist(t)), 'GET', '/assets/app.abc123.js');
  assert.strictEqual(status, 200);
  assert.strictEqual(headers['cache-control'], 'public, max-age=31536000, immutable');
});

test('SPA fallback: an unknown GET path serves index.html', async t => {
  const { status, body, headers } = await request(serve(makeDist(t)), 'GET', '/some/deep/path');
  assert.strictEqual(status, 200);
  assert.match(body, /relay-index/);
  assert.strictEqual(headers['cache-control'], 'no-cache');
});

test('a missing hashed asset is a 404, never index.html (stale tab across a redeploy)', async t => {
  // The old bundle name is gone from the new dist; 200 HTML here would be
  // executed as JS by the still-open tab and die on an opaque syntax error.
  const { status, body } = await request(serve(makeDist(t)), 'GET', '/assets/app.oldhash.js');
  assert.strictEqual(status, 404);
  assert.doesNotMatch(body, /relay-index/);
});

test('an unknown path with a file extension is a 404, not index.html', async t => {
  const { status, body } = await request(serve(makeDist(t)), 'GET', '/favicon.ico');
  assert.strictEqual(status, 404);
  assert.doesNotMatch(body, /relay-index/);
});

test('a dot in a non-final segment still falls back to index.html (navigational path)', async t => {
  const { status, body } = await request(serve(makeDist(t)), 'GET', '/v1.2/settings');
  assert.strictEqual(status, 200);
  assert.match(body, /relay-index/);
});

test('fallback does not shadow /api: an unknown API path stays a 404, not HTML', async t => {
  const { status, body } = await request(serve(makeDist(t)), 'GET', '/api/unknown');
  assert.strictEqual(status, 404);
  assert.doesNotMatch(body, /relay-index/);
});

test('reserved prefixes match case-insensitively: /API/unknown stays a 404, not HTML', async t => {
  // Express's own mount matching is case-insensitive, so /API/x falls through
  // the /api router into this fallback — the exclusion must match it too.
  const { status, body } = await request(serve(makeDist(t)), 'GET', '/API/unknown');
  assert.strictEqual(status, 404);
  assert.doesNotMatch(body, /relay-index/);
});

test('a known /api route still wins over static', async t => {
  const { status, body } = await request(serve(makeDist(t)), 'GET', '/api/known');
  assert.strictEqual(status, 200);
  assert.match(body, /"ok":true/);
});

test('fallback does not shadow /sessions (the WS namespace) — HTTP GET there is a 404', async t => {
  const { status, body } = await request(serve(makeDist(t)), 'GET', '/sessions/7');
  assert.strictEqual(status, 404);
  assert.doesNotMatch(body, /relay-index/);
});

test('fallback is GET/HEAD only: POST to an unknown path is a 404, not index.html', async t => {
  const { status, body } = await request(serve(makeDist(t)), 'POST', '/some/path');
  assert.strictEqual(status, 404);
  assert.doesNotMatch(body, /relay-index/);
});

test('path traversal cannot escape dist', async t => {
  // Whatever the status (403 from express.static, or 200 index.html via the
  // fallback), the file outside dist must never be served.
  const { body } = await request(serve(makeDist(t)), 'GET', '/..%2far-static-outside.txt');
  assert.doesNotMatch(body, /secret/);
});
