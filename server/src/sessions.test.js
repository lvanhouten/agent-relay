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

// --- needs-input: a hook-set flag overlays 'needs-input' until output/input
//     moves past it (a web-tier-only Map; the board owns no such notion) ---

// A line whose last output was `idleMs` ago, evaluated against a fixed clock so
// the flaggedAt vs last-output comparison is deterministic.
function attnSessions(idleMs, { NOW = 1_000_000 } = {}) {
  return new BoardSessions({
    now: () => NOW,
    rpc: async () => ({ ok: true, lines: [{ id: '1', name: 'x', shell: 'bash', cwd: '/', pid: 1, idleMs }] }),
  });
}

test('flagAttention(): a quiet line (no output since the flag) reports needs-input', async () => {
  const s = attnSessions(13000); // last output 13s ago (quiet); flag set "now" is later
  s.flagAttention('1');
  assert.strictEqual((await s.list())[0].status, 'needs-input', 'needs-input overrides the base idle state');
});

test('list(): output arriving after the flag clears it (stale flag dropped)', async () => {
  // Flagged 10s before NOW, but the line's last output was only 1s ago
  // (idleMs=1000) — output landed AFTER the flag, so the agent moved on.
  const NOW = 1_000_000;
  const s = new BoardSessions({
    now: () => NOW,
    rpc: async () => ({ ok: true, lines: [{ id: '1', name: 'x', shell: 'bash', cwd: '/', pid: 1, idleMs: 1000 }] }),
  });
  s._attention.set('1', NOW - 10_000); // lastOutputAt (NOW-1000) > flaggedAt (NOW-10000)
  assert.strictEqual((await s.list())[0].status, 'running');
  assert.strictEqual(s._attention.has('1'), false, 'stale flag is pruned once cleared');
});

test('clearAttention(): explicit clear (WS input) drops the flag immediately', async () => {
  const s = attnSessions(13000);
  s.flagAttention('1');
  s.clearAttention('1');
  assert.strictEqual((await s.list())[0].status, 'idle', 'no longer needs-input; 13s idle -> quiet');
});

test('list(): a flag for a line that has exited is pruned, never resurrected', async () => {
  const s = new BoardSessions({
    now: () => 1_000_000,
    rpc: async () => ({ ok: true, lines: [], ended: [{ id: '1', shell: 'bash', cwd: '/', exitCode: 0, endedAt: 1_000_000, reason: 'exited' }] }),
  });
  s.flagAttention('1');
  const list = await s.list();
  assert.strictEqual(list[0].status, 'exited', 'needs-input never overrides a tombstone');
  assert.strictEqual(s._attention.has('1'), false, 'the dead id is pruned from the flag map');
});

// --- flagAttentionByCwd(): the /api/notify cwd fallback (line-id bridge) ---

// Build sessions whose board `list` returns the given lines; case/separator
// normalization is exercised via the cwds themselves.
function cwdSessions(lines) {
  return new BoardSessions({ rpc: async () => ({ ok: true, lines }) });
}

test('flagAttentionByCwd(): flags the single line whose cwd matches', async () => {
  const s = cwdSessions([
    { id: '1', cwd: '/home/a', idleMs: 0 },
    { id: '2', cwd: '/home/b', idleMs: 0 },
  ]);
  assert.strictEqual(await s.flagAttentionByCwd('/home/b'), '2');
  assert.strictEqual(s._attention.has('2'), true);
  assert.strictEqual(s._attention.has('1'), false, 'only the matching line is flagged');
});

test('flagAttentionByCwd(): matches through path normalization (trailing slash, .., separators)', async () => {
  const s = cwdSessions([{ id: '9', cwd: '/home/a/b', idleMs: 0 }]);
  assert.strictEqual(await s.flagAttentionByCwd('/home/a/x/../b/'), '9', 'resolve() collapses .. and trailing slash');
});

test('flagAttentionByCwd(): on a same-dir tie, the most recently active line (min idleMs) wins', async () => {
  const s = cwdSessions([
    { id: '1', cwd: '/repo', idleMs: 9000 },
    { id: '2', cwd: '/repo', idleMs: 500 },   // most recently active
    { id: '3', cwd: '/repo', idleMs: 4000 },
  ]);
  assert.strictEqual(await s.flagAttentionByCwd('/repo'), '2');
  assert.deepStrictEqual([...s._attention.keys()], ['2'], 'only the freshest match, not all three');
});

test('flagAttentionByCwd(): no live line matches -> null, flags nothing', async () => {
  const s = cwdSessions([{ id: '1', cwd: '/repo', idleMs: 0 }]);
  assert.strictEqual(await s.flagAttentionByCwd('/elsewhere'), null);
  assert.strictEqual(s._attention.size, 0);
});

test('flagAttentionByCwd(): an empty/whitespace cwd never matches (no home-dir over-flag)', async () => {
  const s = cwdSessions([{ id: '1', cwd: '/repo', idleMs: 0 }]);
  assert.strictEqual(await s.flagAttentionByCwd('   '), null);
  assert.strictEqual(await s.flagAttentionByCwd(''), null);
  assert.strictEqual(s._attention.size, 0);
});

test('flagAttentionByCwd(): a board-down list RPC throws BoardUnreachableError (-> 503)', async () => {
  const s = new BoardSessions({ rpc: down });
  await assert.rejects(
    () => s.flagAttentionByCwd('/repo'),
    e => e instanceof BoardUnreachableError && e.boardUnreachable === true,
  );
});
