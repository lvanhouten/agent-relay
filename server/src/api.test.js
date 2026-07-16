'use strict';
// api.js response-code routing tests. Verifies the board-unreachable contract
// end-to-end at the HTTP layer: a down board is a 503 on POST and DELETE, a
// genuine "no such line" is a 404, and a non-board error still 500s via
// the error handler. Uses the real Express router with a fake sessions store.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAPI } = require('./api');
const { BoardUnreachableError } = require('./sessions');
const { errorHandler } = require('./errorHandler');

function serve(sessions, notifiers = [], apiOpts) {
  const app = express();
  app.use(express.json());
  app.use('/api', createAPI(sessions, notifiers, apiOpts));
  // The real handler (index.js's own), not a hand-rolled duplicate that could
  // drift out of sync and go uncovered.
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

test('DELETE /sessions/:id -> 503 when kill() throws BoardUnreachableError', async () => {
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

// --- GET /fs/browse: read-only directory listing for the create dialog ---

test('GET /fs/browse -> 200 with a directories-only listing for a real folder', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'api-browse-'));
  try {
    await fs.promises.mkdir(path.join(dir, 'sub'));
    await fs.promises.writeFile(path.join(dir, 'file.txt'), 'x');
    const app = serve({});
    const { status, body } = await request(app, 'GET', `/api/fs/browse?path=${encodeURIComponent(dir)}`);
    assert.strictEqual(status, 200);
    const parsed = JSON.parse(body);
    assert.deepStrictEqual(parsed.entries, [{ name: 'sub', isDir: true }]);
    assert.strictEqual(parsed.path, path.resolve(dir));
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test('GET /fs/browse -> 400 not-found for a nonexistent path (never a 500)', async () => {
  const app = serve({});
  const missing = path.join(os.tmpdir(), 'api-browse-does-not-exist-zzz');
  const { status, body } = await request(app, 'GET', `/api/fs/browse?path=${encodeURIComponent(missing)}`);
  assert.strictEqual(status, 400);
  assert.strictEqual(JSON.parse(body).error, 'not-found');
});

test('GET /fs/browse -> 400 not-a-directory when the path is a file', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'api-browse-'));
  const filePath = path.join(dir, 'file.txt');
  try {
    await fs.promises.writeFile(filePath, 'x');
    const app = serve({});
    const { status, body } = await request(app, 'GET', `/api/fs/browse?path=${encodeURIComponent(filePath)}`);
    assert.strictEqual(status, 400);
    assert.strictEqual(JSON.parse(body).error, 'not-a-directory');
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test('GET /fs/browse -> 200 (home) on a repeated ?path= array, not a 500', async () => {
  const app = serve({});
  const { status, body } = await request(app, 'GET', '/api/fs/browse?path=a&path=b');
  assert.strictEqual(status, 200);
  assert.strictEqual(JSON.parse(body).path, path.resolve(os.homedir()));
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
  const sessions = { flagAttention: (id) => flagged.push(id), flagAttentionByCwd: async () => null };
  const app = serve(sessions);
  await request(app, 'POST', '/api/notify', { body: { sessionId: '7', body: 'x', needsInput: true } });
  await request(app, 'POST', '/api/notify', { body: { sessionId: '7', body: 'x' } });            // no needsInput
  await request(app, 'POST', '/api/notify', { body: { body: 'x', needsInput: true } });          // no id/cwd -> nothing to flag
  assert.deepStrictEqual(flagged, ['7'], 'only the needsInput+sessionId call flags a session');
});

test('POST /notify with needsInput+cwd (no sessionId) resolves via cwd; sessionId takes precedence', async () => {
  const calls = [];
  const sessions = {
    flagAttention: (id) => calls.push(['byId', id]),
    flagAttentionByCwd: async (cwd) => { calls.push(['byCwd', cwd]); return '3'; },
  };
  const app = serve(sessions);
  await request(app, 'POST', '/api/notify', { body: { cwd: '/repo', body: 'x', needsInput: true } });     // cwd fallback
  await request(app, 'POST', '/api/notify', { body: { sessionId: '7', cwd: '/repo', body: 'x', needsInput: true } }); // id wins
  await request(app, 'POST', '/api/notify', { body: { cwd: '/repo', body: 'x' } });                        // no needsInput
  assert.deepStrictEqual(calls, [['byCwd', '/repo'], ['byId', '7']], 'cwd only resolves absent a sessionId, and only with needsInput');
});

test('POST /notify -> 503 when the cwd resolution RPC finds the board down', async () => {
  const { BoardUnreachableError } = require('./sessions');
  const sessions = { flagAttentionByCwd: async () => { throw new BoardUnreachableError(); } };
  const app = serve(sessions);
  const { status } = await request(app, 'POST', '/api/notify', { body: { cwd: '/repo', body: 'x', needsInput: true } });
  assert.strictEqual(status, 503);
});

// --- POST /notify url policy: the deep link rides a TRUSTED push notification,
// so it is default-deny (rejected unless AR_NOTIFY_URL_ORIGIN names the one
// allowed origin) and compared by parsed origin, never a string prefix. ---

test('POST /notify url -> 400 when no origin is configured (default-deny), sink never reached', async () => {
  const seen = [];
  const app = serve({}, [{ name: 'fake', notify: async (p) => { seen.push(p); } }]);
  const { status } = await request(app, 'POST', '/api/notify', {
    body: { body: 'x', url: 'https://evil.example/phish' },
  });
  assert.strictEqual(status, 400);
  assert.deepStrictEqual(seen, [], 'a rejected url must not fan out');
});

test('POST /notify url on the configured origin passes through', async () => {
  const seen = [];
  const app = serve({}, [{ name: 'fake', notify: async (p) => { seen.push(p); } }],
    { notifyUrlOrigin: 'https://relay.example' });
  const { status } = await request(app, 'POST', '/api/notify', {
    body: { body: 'x', url: 'https://relay.example/sessions/7' },
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(seen[0].url, 'https://relay.example/sessions/7');
});

test('POST /notify url on a foreign origin -> 400, including a prefix-riding lookalike host', async () => {
  const app = serve({}, [], { notifyUrlOrigin: 'https://relay.example' });
  for (const url of [
    'https://evil.example/phish',
    'https://relay.example.evil.com/phish',  // string-prefix of the allowed origin
    'http://relay.example/downgrade',        // scheme is part of the origin
    '/sessions/7',                           // relative: not a tappable Pushover link
  ]) {
    const { status } = await request(app, 'POST', '/api/notify', { body: { body: 'x', url } });
    assert.strictEqual(status, 400, `expected 400 for ${url}`);
  }
});

test('POST /notify -> 200 even when a sink fails (resilient; per-sink outcome reported)', async () => {
  const bad = { name: 'bad', notify: async () => { throw new Error('boom'); } };
  const app = serve({}, [bad]);
  const { status, body } = await request(app, 'POST', '/api/notify', { body: { body: 'x' } });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(JSON.parse(body), { notified: [{ name: 'bad', ok: false, error: 'boom' }] });
});

// --- POST /beacon: lifecycle state, never a push ---

test('POST /beacon -> 200 and calls sessions.beacon for each valid event', async () => {
  const calls = [];
  const sessions = { beacon: async (b) => { calls.push(b); return '7'; } };
  const app = serve(sessions);
  for (const event of ['SessionStart', 'Stop', 'SessionEnd']) {
    const { status, body } = await request(app, 'POST', '/api/beacon', { body: { event, sessionId: '7' } });
    assert.strictEqual(status, 200, event);
    assert.deepStrictEqual(JSON.parse(body), { ok: true, id: '7' });
  }
  assert.deepStrictEqual(calls.map(c => c.event), ['SessionStart', 'Stop', 'SessionEnd']);
});

test('POST /beacon passes the full binding through to sessions.beacon', async () => {
  let seen;
  const app = serve({ beacon: async (b) => { seen = b; return '1'; } });
  await request(app, 'POST', '/api/beacon', {
    body: { event: 'SessionStart', sessionId: '1', claudeSessionId: 'abc', transcriptPath: '/t.jsonl', cwd: '/r' },
  });
  assert.deepStrictEqual(seen, { event: 'SessionStart', sessionId: '1', claudeSessionId: 'abc', transcriptPath: '/t.jsonl', cwd: '/r' });
});

test('POST /beacon -> 200 with id: null when nothing matched', async () => {
  const app = serve({ beacon: async () => null });
  const { status, body } = await request(app, 'POST', '/api/beacon', { body: { event: 'Stop', cwd: '/nowhere' } });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(JSON.parse(body), { ok: true, id: null });
});

test('POST /beacon never invokes the push notifiers', async () => {
  const seen = [];
  const notifier = { name: 'fake', notify: async (p) => { seen.push(p); } };
  const app = serve({ beacon: async () => '1' }, [notifier]);
  const { status } = await request(app, 'POST', '/api/beacon', { body: { event: 'Stop', sessionId: '1' } });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(seen, [], 'a beacon carries no push');
});

test('POST /beacon -> 415 on a non-JSON content type', async () => {
  const app = serve({ beacon: async () => { throw new Error('beacon must not be reached'); } });
  const { status } = await request(app, 'POST', '/api/beacon', { contentType: 'text/plain' });
  assert.strictEqual(status, 415);
});

test('POST /beacon -> 400 on an unrecognized or missing event', async () => {
  const app = serve({ beacon: async () => { throw new Error('beacon must not be reached'); } });
  for (const body of [{ event: 'PreToolUse', sessionId: '1' }, { sessionId: '1' }]) {
    const { status } = await request(app, 'POST', '/api/beacon', { body });
    assert.strictEqual(status, 400, JSON.stringify(body));
  }
});

test('POST /beacon -> 400 on an oversized field', async () => {
  const app = serve({ beacon: async () => { throw new Error('beacon must not be reached'); } });
  const { status } = await request(app, 'POST', '/api/beacon', { body: { event: 'Stop', sessionId: 'x'.repeat(201) } });
  assert.strictEqual(status, 400);
});

test('POST /beacon -> 503 when beacon() throws BoardUnreachableError', async () => {
  const app = serve({ beacon: async () => { throw new BoardUnreachableError(); } });
  const { status } = await request(app, 'POST', '/api/beacon', { body: { event: 'Stop', cwd: '/r' } });
  assert.strictEqual(status, 503);
});

// Direct unit tests against the real handler, including the headersSent branch.
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
