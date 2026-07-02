'use strict';
// Board-down classification tests for BoardSessions. C2's fix made list()/get()
// throw BoardUnreachableError; these cover the residual (new-W1): spawn() and
// kill() must honor the same contract so api.js can answer 503 (not 500/404)
// when the board is down.
const test = require('node:test');
const assert = require('node:assert');
const { BoardSessions, BoardUnreachableError } = require('./sessions');

const down = () => { const e = new Error('board rpc timed out'); return Promise.reject(e); };

test('spawn(): a board-down RPC throws BoardUnreachableError (new-W1)', async () => {
  const s = new BoardSessions({ rpc: down });
  await assert.rejects(
    () => s.spawn({ name: 'x', cwd: '~/', command: 'bash' }),
    e => e instanceof BoardUnreachableError && e.boardUnreachable === true,
  );
});

test('spawn(): a board-reachable-but-not-ok reply is a plain Error, not BoardUnreachableError', async () => {
  const s = new BoardSessions({ rpc: async () => ({ ok: false }) });
  await assert.rejects(
    () => s.spawn({ name: 'x' }),
    e => !(e instanceof BoardUnreachableError) && /refused spawn/.test(e.message),
  );
});

test('kill(): a board-down RPC throws BoardUnreachableError (new-W1)', async () => {
  const s = new BoardSessions({ rpc: down });
  await assert.rejects(
    () => s.kill('7'),
    e => e instanceof BoardUnreachableError && e.boardUnreachable === true,
  );
});

test('kill(): a reachable board reporting no such line returns false (-> 404, not 503)', async () => {
  const s = new BoardSessions({ rpc: async () => ({ ok: false }) });
  assert.strictEqual(await s.kill('nope'), false);
});

test('kill(): a successful end returns true', async () => {
  const s = new BoardSessions({ rpc: async () => ({ ok: true }) });
  assert.strictEqual(await s.kill('7'), true);
});
