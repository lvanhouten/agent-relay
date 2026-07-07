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
  // Flag at t=990s via the public surface (mutable injected clock), then list
  // at t=1000s with the line's last output 1s ago (idleMs=1000) — output
  // landed AFTER the flag, so the agent moved on.
  let now = 990_000;
  const s = new BoardSessions({
    now: () => now,
    rpc: async () => ({ ok: true, lines: [{ id: '1', name: 'x', shell: 'bash', cwd: '/', pid: 1, idleMs: 1000 }] }),
  });
  s.flagAttention('1');
  now = 1_000_000; // lastOutputAt (NOW-1000) > flaggedAt (990_000)
  assert.strictEqual((await s.list())[0].status, 'running');
  // Memory hygiene (the entry is deleted, not just re-evaluated false) has no
  // public observation — the one place direct field access stays.
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
  // Memory hygiene — not publicly observable (see the stale-flag test above).
  assert.strictEqual(s._attention.has('1'), false, 'the dead id is pruned from the flag map');
});

test('list(): a board restart (boot nonce change) voids every attention flag', async () => {
  // Line ids restart per board boot, so a web tier that outlives a board
  // restart could hold a flag a REUSED id would inherit — a fresh quiet line
  // reading needs-input. The boot nonce in the list reply is the restart signal.
  let boot = 'boot-A';
  const s = new BoardSessions({
    now: () => 1_000_000,
    rpc: async () => ({ ok: true, boot, lines: [{ id: '1', name: 'x', shell: 'bash', cwd: '/', pid: 1, idleMs: 13000 }] }),
  });
  s.flagAttention('1');
  assert.strictEqual((await s.list())[0].status, 'needs-input', 'first sight of a nonce is not a restart');
  boot = 'boot-B'; // board restarted; id 1 is now a different, fresh line
  assert.strictEqual((await s.list())[0].status, 'idle', 'the reused id must not inherit the old flag');
});

test('toDto(): a non-finite idleMs reads as just-active, never "NaNs ago"', async () => {
  // ?? only covers null/undefined — a NaN would compare false into 'idle' and
  // render a NaN relative time on the card.
  const s = new BoardSessions({
    rpc: async () => ({ ok: true, lines: [{ id: '1', name: 'x', shell: 'bash', cwd: '/', pid: 1, idleMs: NaN }] }),
  });
  const dto = (await s.list())[0];
  assert.strictEqual(dto.status, 'running');
  assert.match(dto.lastActive, /^\d+s ago$/);
});

// --- flagAttentionByCwd(): the /api/notify cwd fallback (line-id bridge) ---

// Build sessions whose board `list` returns the given lines; case/separator
// normalization is exercised via the cwds themselves. Fixed clock so the
// flaggedAt vs last-output comparison in list()'s overlay is deterministic,
// letting these tests observe flags through the public status instead of the
// private map (N4: representation-coupled tests).
function cwdSessions(lines) {
  return new BoardSessions({ now: () => 1_000_000, rpc: async () => ({ ok: true, lines }) });
}

// The public observation of "which lines are flagged": list()'s status overlay.
async function statusById(s) {
  return Object.fromEntries((await s.list()).map((x) => [x.id, x.status]));
}

test('flagAttentionByCwd(): flags the single line whose cwd matches', async () => {
  const s = cwdSessions([
    { id: '1', cwd: '/home/a', idleMs: 0 },
    { id: '2', cwd: '/home/b', idleMs: 0 },
  ]);
  assert.strictEqual(await s.flagAttentionByCwd('/home/b'), '2');
  assert.deepStrictEqual(await statusById(s), { 1: 'running', 2: 'needs-input' }, 'only the matching line is flagged');
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
  assert.deepStrictEqual(await statusById(s), { 1: 'running', 2: 'needs-input', 3: 'running' }, 'only the freshest match, not all three');
});

test('flagAttentionByCwd(): no live line matches -> null, flags nothing', async () => {
  const s = cwdSessions([{ id: '1', cwd: '/repo', idleMs: 0 }]);
  assert.strictEqual(await s.flagAttentionByCwd('/elsewhere'), null);
  assert.deepStrictEqual(await statusById(s), { 1: 'running' });
});

test('flagAttentionByCwd(): an empty/whitespace cwd never matches (no home-dir over-flag)', async () => {
  const s = cwdSessions([{ id: '1', cwd: '/repo', idleMs: 0 }]);
  assert.strictEqual(await s.flagAttentionByCwd('   '), null);
  assert.strictEqual(await s.flagAttentionByCwd(''), null);
  assert.deepStrictEqual(await statusById(s), { 1: 'running' });
});

test('flagAttentionByCwd(): a board-down list RPC throws BoardUnreachableError (-> 503)', async () => {
  const s = new BoardSessions({ rpc: down });
  await assert.rejects(
    () => s.flagAttentionByCwd('/repo'),
    e => e instanceof BoardUnreachableError && e.boardUnreachable === true,
  );
});
