'use strict';
// Board-down classification tests for BoardSessions. C2's fix made list()/get()
// throw BoardUnreachableError; these cover the residual (new-W1): spawn() and
// kill() must honor the same contract so api.js can answer 503 (not 500/404)
// when the board is down.
const test = require('node:test');
const assert = require('node:assert');
const { BoardSessions, BoardUnreachableError } = require('./sessions');
const { DEFAULT_IDLE_MS } = require('../board/wait');

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

test('kill(): a successful end returns true without a forget round-trip', async () => {
  const calls = [];
  const s = new BoardSessions({ rpc: async m => { calls.push(m.cmd); return { ok: true }; } });
  assert.strictEqual(await s.kill('7'), true);
  assert.deepStrictEqual(calls, ['end'], 'a live kill never falls through to forget');
});

test('kill(): falls through to forget so DELETE on a tombstone dismisses it', async () => {
  const calls = [];
  const s = new BoardSessions({
    rpc: async m => { calls.push(m.cmd); return { ok: m.cmd === 'forget' }; },
  });
  assert.strictEqual(await s.kill('7'), true);
  assert.deepStrictEqual(calls, ['end', 'forget']);
});

test('kill(): a board-down forget still classifies as unreachable (503, not 404)', async () => {
  const s = new BoardSessions({
    rpc: async m => {
      if (m.cmd === 'end') return { ok: false };
      throw new Error('board rpc timed out');
    },
  });
  await assert.rejects(
    () => s.kill('7'),
    e => e instanceof BoardUnreachableError && e.boardUnreachable === true,
  );
});

// --- tombstones: list() maps the board's `ended` ring to exited-session DTOs ---

test('list(): tombstones map to status exited with their exit metadata', async () => {
  const s = new BoardSessions({
    rpc: async () => ({
      ok: true,
      lines: [{ id: '2', name: 'live', shell: 'pwsh.exe', cwd: 'C:\\w', pid: 42, idleMs: 0 }],
      ended: [
        { id: '1', name: 'ran', shell: 'pwsh.exe', cwd: 'C:\\w', exitCode: 3, endedAt: Date.now() - 5000, reason: 'exited' },
        { id: '0', name: '', shell: 'bash', cwd: '/w', exitCode: 1, endedAt: Date.now(), reason: 'killed' },
      ],
    }),
  });
  const list = await s.list();
  assert.deepStrictEqual(list.map(x => x.status), ['running', 'exited', 'exited'],
    'live lines first, then tombstones');
  const [, ran, anon] = list;
  assert.strictEqual(ran.exitCode, 3);
  assert.strictEqual(ran.reason, 'exited');
  assert.strictEqual(ran.pid, null, 'no pid on a dead process');
  assert.strictEqual(ran.lastActive, '5s ago', 'lastActive comes from endedAt');
  assert.strictEqual(anon.name, 'session-0', 'unnamed tombstones get the same fallback as live lines');
  assert.strictEqual(anon.reason, 'killed');
});

test('list(): an older board reply without `ended` still lists live lines', async () => {
  const s = new BoardSessions({
    rpc: async () => ({ ok: true, lines: [{ id: '1', name: 'x', shell: 'bash', cwd: '/', pid: 1, idleMs: 0 }] }),
  });
  const list = await s.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].status, 'running');
});

// --- attention states: status derives from idleMs against wait.js's threshold ---

test('list(): idleMs at/beyond the shared threshold is idle, below is running, absent is running', async () => {
  const line = (id, idleMs) => ({ id, name: id, shell: 'bash', cwd: '/', pid: 1, idleMs });
  const s = new BoardSessions({
    rpc: async () => ({
      ok: true,
      lines: [
        line('fresh', 0),
        line('almost', DEFAULT_IDLE_MS - 1),
        line('quiet', DEFAULT_IDLE_MS),
        { id: 'old-board', name: 'old-board', shell: 'bash', cwd: '/', pid: 1 }, // no idleMs field
      ],
    }),
  });
  const byId = Object.fromEntries((await s.list()).map(x => [x.id, x.status]));
  assert.deepStrictEqual(byId, {
    fresh: 'running',
    almost: 'running',
    quiet: 'idle',
    'old-board': 'running',
  });
});

test('spawn(): a just-created session reports running', async () => {
  const s = new BoardSessions({
    rpc: async () => ({ ok: true, id: '5', name: 'x', shell: 'bash', cwd: '/', pid: 9 }),
  });
  const dto = await s.spawn({ name: 'x' });
  assert.strictEqual(dto.status, 'running');
});

test('get(): finds a tombstone by id (so the WS hub can refuse it as exited)', async () => {
  const s = new BoardSessions({
    rpc: async () => ({ ok: true, lines: [], ended: [{ id: '9', shell: 'bash', cwd: '/', exitCode: 0, endedAt: Date.now(), reason: 'exited' }] }),
  });
  const got = await s.get('9');
  assert.ok(got);
  assert.strictEqual(got.status, 'exited');
});
