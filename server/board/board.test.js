'use strict';
// openPane refusal must show in paneOpened, not just a log (pure helpers, no pty).
const test = require('node:test');
const assert = require('node:assert');
const { paneSpawnDecision, openPane, handle, notifyClientsClosed, attachWithReplay, makeRunFeeder, bringOnline,
  makeEndedRegistry, endedLines, makeScreenLifecycle, screenPreview, previewTail, isRuleRow, scrubClaudeSessionMarkers, CLAUDE_SESSION_MARKERS } = require('./board');

test('scrubClaudeSessionMarkers: removes every allowlisted marker and reports them', () => {
  const env = {};
  for (const k of CLAUDE_SESSION_MARKERS) env[k] = 'x';
  const removed = scrubClaudeSessionMarkers(env);
  for (const k of CLAUDE_SESSION_MARKERS) assert.ok(!(k in env), `${k} deleted`);
  assert.deepStrictEqual(removed.sort(), [...CLAUDE_SESSION_MARKERS].sort());
});

test('scrubClaudeSessionMarkers: preserves deliberate config/preference vars (never a CLAUDE_* glob)', () => {
  // Allowlist-only scrub - can't distinguish inherited session markers from deliberate config.
  const env = {
    CLAUDE_CODE_CHILD_SESSION: '1',   // marker -> scrubbed
    CLAUDECODE: '1',                  // marker -> scrubbed
    CLAUDE_EFFORT: 'high',            // preference -> survives
    CLAUDE_AFK_TIMEOUT_MS: '600000',  // preference -> survives
    ANTHROPIC_API_KEY: 'sk-secret',   // config -> survives
    PATH: '/usr/bin',                 // unrelated -> survives
  };
  scrubClaudeSessionMarkers(env);
  assert.ok(!('CLAUDE_CODE_CHILD_SESSION' in env));
  assert.ok(!('CLAUDECODE' in env));
  assert.strictEqual(env.CLAUDE_EFFORT, 'high');
  assert.strictEqual(env.CLAUDE_AFK_TIMEOUT_MS, '600000');
  assert.strictEqual(env.ANTHROPIC_API_KEY, 'sk-secret');
  assert.strictEqual(env.PATH, '/usr/bin');
});

test('scrubClaudeSessionMarkers: absent markers are a no-op (nothing reported removed)', () => {
  const env = { PATH: '/usr/bin' };
  const removed = scrubClaudeSessionMarkers(env);
  assert.deepStrictEqual(removed, []);
  assert.deepStrictEqual(env, { PATH: '/usr/bin' });
});

test('paneSpawnDecision: a standalone {cmd} arg is spawnable', () => {
  const d = paneSpawnDecision({ file: 'wezterm', args: ['cli', 'spawn', '--', '{cmd}'] });
  assert.strictEqual(d.standalone, true);
  assert.strictEqual(d.embedded, false);
});

test('paneSpawnDecision: {cmd} embedded in a larger string is refused', () => {
  // SWITCHBOARD_TERM="sh -c '{cmd}'" -> ["sh","-c","'{cmd}'"]
  const d = paneSpawnDecision({ file: 'sh', args: ['-c', "'{cmd}'"] });
  assert.strictEqual(d.standalone, false);
  assert.strictEqual(d.embedded, true);
});

test('paneSpawnDecision: no {cmd} token at all is refused', () => {
  const d = paneSpawnDecision({ file: 'sh', args: ['-c', 'echo hi'] });
  assert.strictEqual(d.standalone, false);
  assert.strictEqual(d.embedded, false);
});

test('openPane: returns false (no process) when the recipe is refused', () => {
  const opened = openPane('99', { file: 'sh', args: ['-c', "'{cmd}'"] });
  assert.strictEqual(opened, false);
});

// Missing-line join touches no pty; paneOpened must always be present to branch on.
function capture() {
  const chunks = [];
  return { sock: { write: s => chunks.push(s) }, reply: () => JSON.parse(chunks.join('')) };
}

test('join reply for a missing line reports ok:false and paneOpened:null', () => {
  const c = capture();
  handle({ cmd: 'join', id: 'no-such-line' }, c.sock);
  const r = c.reply();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.paneOpened, null, 'no pane attempted for a missing line');
  assert.ok('paneOpened' in r, 'the field is present so callers can branch on it');
});

// A throwing client.end() must not abort others or propagate - uncaught here kills the daemon.
test('notifyClientsClosed: a throwing client does not abort the others or propagate', () => {
  const notified = [];
  const good = suffix => ({ end: f => notified.push(suffix + f) });
  const bad = { end: () => { throw new Error('socket in a bad state'); } };
  const clients = new Set([good('a:'), bad, good('b:')]);
  assert.doesNotThrow(() => notifyClientsClosed(clients, 'BYE'));
  assert.deepStrictEqual(notified, ['a:BYE', 'b:BYE'], 'both healthy clients still notified');
});

// Registry is pure ring+forget; handle() tests pin the wire surface (list.ended, forget).

test('makeEndedRegistry: records in order and caps at the ring size', () => {
  const reg = makeEndedRegistry(3);
  for (let i = 1; i <= 5; i++) reg.record({ id: String(i), exitCode: 0 });
  assert.deepStrictEqual(reg.list().map(t => t.id), ['3', '4', '5'],
    'oldest tombstones fall off the ring first');
});

test('makeEndedRegistry: forget removes exactly one tombstone, reports unknown ids', () => {
  const reg = makeEndedRegistry();
  reg.record({ id: '1', exitCode: 0 });
  reg.record({ id: '2', exitCode: 1 });
  assert.strictEqual(reg.forget('1'), true);
  assert.deepStrictEqual(reg.list().map(t => t.id), ['2']);
  assert.strictEqual(reg.forget('1'), false, 'already dismissed');
  assert.strictEqual(reg.forget('nope'), false, 'never existed');
});

test('makeEndedRegistry: get(id) returns the tombstone by id, undefined for an unknown id', () => {
  const reg = makeEndedRegistry();
  reg.record({ id: '1', exitCode: 0 });
  reg.record({ id: '2', exitCode: 5 });
  assert.strictEqual(reg.get('2').exitCode, 5, 'returns the matching tombstone');
  assert.strictEqual(reg.get('nope'), undefined, 'unknown id → undefined');
});

test('makeEndedRegistry: list() returns a copy, not the live ring', () => {
  const reg = makeEndedRegistry();
  reg.record({ id: '1' });
  reg.list().pop();
  assert.strictEqual(reg.list().length, 1, 'mutating a listing must not drop a tombstone');
});

test("handle('list') carries the ended tombstones alongside live lines", async () => {
  endedLines.record({ id: 'tomb-1', name: 'x', exitCode: 3, reason: 'exited' });
  try {
    const c = capture();
    await handle({ cmd: 'list' }, c.sock);   // list is async (it may await per-line screen reads)
    const r = c.reply();
    assert.strictEqual(r.ok, true);
    assert.ok(Array.isArray(r.ended), 'list reply has an ended array');
    const t = r.ended.find(e => e.id === 'tomb-1');
    assert.ok(t, 'the recorded tombstone is listed');
    assert.strictEqual(t.exitCode, 3);
    assert.strictEqual(t.reason, 'exited');
  } finally {
    endedLines.forget('tomb-1');   // module-level registry — leave it clean
  }
});

test("handle('forget') dismisses a tombstone once, then reports ok:false", () => {
  endedLines.record({ id: 'tomb-2', exitCode: 0, reason: 'killed' });
  const c1 = capture();
  handle({ cmd: 'forget', id: 'tomb-2' }, c1.sock);
  assert.strictEqual(c1.reply().ok, true);
  const c2 = capture();
  handle({ cmd: 'forget', id: 'tomb-2' }, c2.sock);
  assert.strictEqual(c2.reply().ok, false, 'second dismiss finds nothing');
});

// Secret persists only on bind success - a bind-race loser must never clobber the winner's on-disk secret.

test('bringOnline: persists the secret ONLY after the bind succeeds, never before', () => {
  const calls = [];
  let bindCb = null;
  bringOnline({
    generate: () => 'SEKRET',
    assign: s => calls.push(['assign', s]),
    listen: cb => { calls.push(['listen']); bindCb = cb; },  // bind not confirmed yet
    persist: s => calls.push(['persist', s]),
    ready: () => calls.push(['ready']),
  });
  // Secret is set in memory; nothing written to disk before the bind succeeds.
  assert.deepStrictEqual(calls, [['assign', 'SEKRET'], ['listen']],
    'no persist before the bind-success callback fires');
  bindCb();  // this process won the pipe
  assert.deepStrictEqual(calls,
    [['assign', 'SEKRET'], ['listen'], ['persist', 'SEKRET'], ['ready']],
    'secret persisted only inside the bind-success callback');
});

test('bringOnline: a process that LOSES the bind race never persists the secret', () => {
  const calls = [];
  bringOnline({
    generate: () => 'LOSER',
    assign: s => calls.push(['assign', s]),
    // Bind fails (EADDRINUSE): success callback never invoked; real error handler exits(0).
    listen: () => { calls.push(['listen']); },
    persist: s => calls.push(['persist', s]),
  });
  assert.ok(!calls.some(c => c[0] === 'persist'),
    "the losing process must never overwrite the winner's on-disk secret");
});

// Fake clock/scheduler: advance(ms) fires due timers in order, including ones scheduled by a firing callback.
function feederHarness(run, opts = {}) {
  let t = 0, seq = 0, scheduleCount = 0, alive = true;
  const timers = new Map();
  const writes = [];
  const feeder = makeRunFeeder(run, {
    write: d => writes.push(d),
    isAlive: () => alive,
    schedule: (fn, ms) => { scheduleCount++; const id = ++seq; timers.set(id, { due: t + ms, fn }); return id; },
    cancel: id => { if (id != null) timers.delete(id); },
    now: () => t,
    debounceMs: 120, confirmMs: 500, maxSends: 2, ...opts,
  });
  return {
    feeder, writes,
    scheduleCount: () => scheduleCount,
    kill: () => { alive = false; },
    advance(ms) {
      const target = t + ms;
      for (;;) {
        let next = null;
        for (const [id, tm] of timers) if (tm.due <= target && (!next || tm.due < next.tm.due)) next = { id, tm };
        if (!next) break;
        t = next.tm.due; timers.delete(next.id); next.tm.fn();
      }
      t = target;
    },
  };
}

test('makeRunFeeder: sends once after the debounce, then settles when the shell echoes', () => {
  const h = feederHarness('claude');
  h.feeder.onData();            // prompt appears
  h.advance(120);               // debounce elapses -> send
  assert.deepStrictEqual(h.writes, ['claude\r']);
  h.feeder.onData();            // the shell echoes our keystrokes -> reacted
  h.advance(1000);              // confirm window passes: no retry, we settled
  assert.deepStrictEqual(h.writes, ['claude\r'], 'exactly one send once the shell reacted');
});

test('makeRunFeeder: retries once on total post-send silence (dropped feed), capped', () => {
  const h = feederHarness('claude');
  h.feeder.onData();
  h.advance(120);               // send #1
  assert.strictEqual(h.writes.length, 1);
  h.advance(500);               // no reaction within the confirm window -> retry
  assert.strictEqual(h.writes.length, 2, 're-sent once when the shell never reacted');
  h.advance(500);               // still silent, but maxSends reached
  assert.strictEqual(h.writes.length, 2, 'capped at maxSends — never runs a third time');
});

test('makeRunFeeder: a reaction after the first send prevents any retry (double-run safety)', () => {
  const h = feederHarness('claude');
  h.feeder.onData();
  h.advance(120);               // send #1
  h.advance(300);               // partway into the confirm window
  h.feeder.onData();            // the shell reacts (echo/output) -> delivered
  h.advance(1000);
  assert.strictEqual(h.writes.length, 1, 'no re-send — output after the send means it landed');
});

test('makeRunFeeder: a silent-on-start shell is fed via the fallback, then confirmed', () => {
  const h = feederHarness('claude');
  h.feeder.onFallback();        // no output ever -> hard backstop fires the send
  assert.strictEqual(h.writes.length, 1);
  h.advance(500);               // still silent -> one retry
  assert.strictEqual(h.writes.length, 2);
});

test('makeRunFeeder: bursty startup uses a single debounce timer, not one per burst', () => {
  const h = feederHarness('claude');
  h.feeder.onData();            // schedules debounce (due 120)
  h.advance(50);
  h.feeder.onData();            // cancels + reschedules (due 170) — not a 2nd live timer
  h.advance(100);               // t=150: the original 120 timer was cancelled, so no send yet
  assert.strictEqual(h.writes.length, 0, 'the first debounce timer was cancelled, not left to fire');
  h.advance(50);                // t=200: the rescheduled timer fires
  assert.deepStrictEqual(h.writes, ['claude\r'], 'exactly one send, after the last burst went quiet');
});

test('makeRunFeeder: never writes once the line is gone', () => {
  const h = feederHarness('claude');
  h.feeder.onData();
  h.kill();
  h.advance(120);               // debounce fires but the line is dead
  assert.strictEqual(h.writes.length, 0);
});

// Fake emulator, no real pty/VT; construction count proves lazy-init (no emulator before first read).
function screenHarness({ size = { cols: 80, rows: 24 }, scrollback = [] } = {}) {
  let constructed = 0;
  const emulator = {
    writes: [],
    resizes: [],
    disposed: 0,
    cols: size.cols,
    rows: size.rows,
    write(b) { this.writes.push(b); },
    resize(c, r) { this.resizes.push([c, r]); this.cols = c; this.rows = r; },
    snapshot() {
      return Promise.resolve({
        grid: this.writes.join(''),
        cursor: { row: 0, col: 0 },
        cols: this.cols,
        rows: this.rows,
      });
    },
    dispose() { this.disposed += 1; },
  };
  const createArgs = [];
  const life = makeScreenLifecycle({
    create: (cols, rows) => { constructed += 1; createArgs.push([cols, rows]); emulator.cols = cols; emulator.rows = rows; return emulator; },
    getSize: () => size,
    getScrollback: () => scrollback,
  });
  return { life, emulator, createArgs, constructed: () => constructed };
}

test('makeScreenLifecycle: no emulator is constructed until the first read', () => {
  const h = screenHarness();
  assert.strictEqual(h.constructed(), 0, 'nothing built on creation');
  assert.strictEqual(h.life._initialized(), false);
  // Pre-read feed/resize must not force construction - an unread line allocates nothing.
  h.life.feed('ignored');
  h.life.resize(10, 5);
  assert.strictEqual(h.constructed(), 0, 'feed/resize before first read stay no-ops');
  assert.strictEqual(h.emulator.writes.length, 0, 'pre-init feed reached no emulator');
});

test('makeScreenLifecycle: first read lazy-inits at the current size and seeds from scrollback', async () => {
  const h = screenHarness({ size: { cols: 100, rows: 40 }, scrollback: ['aaa', 'bbb'] });
  const snap = await h.life.read();
  assert.strictEqual(h.constructed(), 1, 'exactly one emulator constructed on first read');
  assert.deepStrictEqual(h.createArgs[0], [100, 40], 'sized to the live PTY dims');
  assert.deepStrictEqual(h.emulator.writes, ['aaa', 'bbb'], 'existing scrollback replayed into the fresh emulator');
  assert.strictEqual(snap.grid, 'aaabbb');
  assert.strictEqual(h.life._initialized(), true);
});

test('makeScreenLifecycle: a second read reuses the same instance (no re-construction)', async () => {
  const h = screenHarness({ scrollback: ['seed'] });
  await h.life.read();
  await h.life.read();
  assert.strictEqual(h.constructed(), 1, 'the emulator is built once, then reused');
});

test('makeScreenLifecycle: live feed writes to the same initialized instance', async () => {
  const h = screenHarness({ scrollback: ['seed'] });
  await h.life.read();
  h.life.feed('LIVE');
  const snap = await h.life.read();
  assert.strictEqual(h.constructed(), 1);
  assert.deepStrictEqual(h.emulator.writes, ['seed', 'LIVE'], 'post-init feed reaches the emulator');
  assert.strictEqual(snap.grid, 'seedLIVE');
});

test('makeScreenLifecycle: resize forwards to the initialized emulator', async () => {
  const h = screenHarness();
  await h.life.read();
  h.life.resize(42, 12);
  assert.deepStrictEqual(h.emulator.resizes, [[42, 12]], 'resize forwarded once initialized');
  const snap = await h.life.read();
  assert.strictEqual(snap.cols, 42);
  assert.strictEqual(snap.rows, 12);
});

test('makeScreenLifecycle: dispose releases the emulator and drops the reference', async () => {
  const h = screenHarness();
  await h.life.read();
  h.life.dispose();
  assert.strictEqual(h.emulator.disposed, 1, 'the emulator was disposed');
  assert.strictEqual(h.life._initialized(), false, 'the per-line reference was dropped');
  // Dispose again is a harmless no-op (no double-dispose after the drop).
  h.life.dispose();
  assert.strictEqual(h.emulator.disposed, 1);
});

// p.onExit may dispose mid-read; a disposed lifecycle must return null, never a stale/torn grid.

test('makeScreenLifecycle: a read after dispose refuses to rebuild and returns null', async () => {
  const h = screenHarness({ scrollback: ['seed'] });
  await h.life.read();               // build the emulator on the first read
  h.life.dispose();
  const snap = await h.life.read();  // first read landing after the line exited
  assert.strictEqual(snap, null, 'a disposed screen refuses the read');
  assert.strictEqual(h.constructed(), 1, 'no second emulator built for a dead line (no leak)');
});

test('makeScreenLifecycle: a first read after dispose builds nothing at all (lazy-init leg)', async () => {
  const h = screenHarness({ scrollback: ['seed'] });
  h.life.dispose();                  // line exited before it was ever screen-read
  const snap = await h.life.read();
  assert.strictEqual(snap, null, 'disposed-before-first-read yields null');
  assert.strictEqual(h.constructed(), 0, 'no emulator ever constructed for a line that exited unread');
});

test('makeScreenLifecycle: a dispose during an in-flight read discards the grid (mid-flush)', async () => {
  let resolveSnap;
  const emulator = {
    write() {}, resize() {},
    // snapshot() parks until we release it, standing in for the awaited flush.
    snapshot() { return new Promise(r => { resolveSnap = () => r({ grid: 'STALE', cursor: { row: 0, col: 0 }, cols: 80, rows: 24 }); }); },
    dispose() {},
  };
  const life = makeScreenLifecycle({
    create: () => emulator,
    getSize: () => ({ cols: 80, rows: 24 }),
    getScrollback: () => [],
  });
  const reading = life.read();       // starts snapshot(), now awaiting the flush
  life.dispose();                    // onExit fires mid-flush
  resolveSnap();                     // the flush resolves AFTER dispose
  assert.strictEqual(await reading, null, 'a grid produced after dispose is discarded, not returned');
});

// Live screen reads are covered by the e2e test; here: not-live branches, distinguished by `ended`.

test("handle('screen') for an id that never existed replies ok:false, ended:false", async () => {
  const c = capture();
  await handle({ cmd: 'screen', id: 'ghost' }, c.sock);
  const r = c.reply();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.ended, false, 'never-existed is not an exit');
});

test("handle('screen') for an exited line replies ended:true with its exitCode, distinct from never-existed", async () => {
  endedLines.record({ id: 'tomb-scr', exitCode: 7, reason: 'exited' });
  try {
    const c = capture();
    await handle({ cmd: 'screen', id: 'tomb-scr' }, c.sock);
    const dead = c.reply();
    assert.strictEqual(dead.ok, false);
    assert.strictEqual(dead.ended, true);
    assert.strictEqual(dead.exitCode, 7, 'the tombstone exit code rides the reply');

    const c2 = capture();
    await handle({ cmd: 'screen', id: 'ghost' }, c2.sock);
    const none = c2.reply();
    assert.notDeepStrictEqual(
      { ok: dead.ok, ended: dead.ended },
      { ok: none.ok, ended: none.ended },
      'the two failure replies are distinguishable, not merely both falsy');
  } finally {
    endedLines.forget('tomb-scr');   // module-level registry — leave it clean
  }
});

// A Claude TUI's bottom input box + status line (leaks usage/reset info) must never appear in the preview.
const RULE = '─'.repeat(79);
const CLAUDE_GRID = [
  '● Ran the test suite',
  '  42 passing, 0 failing',
  '',
  RULE,
  '❯',
  RULE,
  '  [Opus(high)] agent-relay | ⎇ main',
  '  ctx 105.9k/1m (11%) · last msg 08:19:48',
  '  1% (4h50m) - resets at 1:10 PM EST',
].join('\n');

test('isRuleRow: a full-width horizontal rule is a rule row; content and short runs are not', () => {
  assert.ok(isRuleRow(RULE));
  assert.ok(isRuleRow('╭' + '─'.repeat(40) + '╮'), 'rounded box border with corners');
  assert.ok(!isRuleRow('  ctx 105.9k/1m (11%)'), 'a status line is not a rule');
  assert.ok(!isRuleRow('───'), 'a short run below the length gate is not a rule');
  assert.ok(!isRuleRow(''), 'blank is not a rule');
});

test('previewTail: a Claude input box + status line are dropped, output above is shown', () => {
  const tail = previewTail(CLAUDE_GRID, 3);
  // 2 content rows sit above the box; the blank before it is trimmed, so a 3-row ask yields both.
  assert.deepStrictEqual(tail, ['● Ran the test suite', '  42 passing, 0 failing']);
  // No border, prompt, or status leaked.
  assert.ok(!tail.some(r => r.includes('❯')), 'prompt line dropped');
  assert.ok(!tail.some(r => r.includes('─')), 'rule rows dropped');
  assert.ok(!tail.some(r => r.includes('resets at')), 'status line dropped');
});

test('previewTail: trailing blank rows above the box are trimmed before the tail', () => {
  const tail = previewTail(CLAUDE_GRID, 2);
  assert.deepStrictEqual(tail, ['● Ran the test suite', '  42 passing, 0 failing']);
});

test('previewTail: a plain grid with no input box is tailed as-is', () => {
  const grid = ['line one', 'line two', 'line three', 'line four'].join('\n');
  assert.deepStrictEqual(previewTail(grid, 2), ['line three', 'line four']);
});

test('previewTail: a single trailing rule (no bracketing pair) is still cut from', () => {
  const grid = ['output above', RULE].join('\n');
  assert.deepStrictEqual(previewTail(grid, 3), ['output above']);
});

// Async replay: order must be replay, then buffered live output, then join as a live client.

function fakeSession(buf = [], cols = 120, rows = 30) {
  return { buf, pty: { cols, rows }, clients: new Set(), pending: new Map() };
}
function fakeSock() {
  const writes = [];
  return { writes, write(d) { writes.push(d); return true; }, end() {} };
}
// Mimic the board's p.onData fan-out for one live output burst.
function emitLive(s, d) {
  s.buf.push(d);
  for (const c of s.clients) c.write(d);
  for (const pend of s.pending.values()) pend.queue.push(d);
}

test('attachWithReplay: replay first, then live output buffered during reconstruction, then joins clients', async () => {
  const s = fakeSession(['hist']);
  const sock = fakeSock();
  let finish;
  const reconstruct = () => new Promise(r => { finish = r; });
  const p = attachWithReplay(s, '1', sock, reconstruct);

  // Mid-reconstruction the socket is pending, not a live client, and silent.
  assert.ok(s.pending.has(sock), 'pending during reconstruction');
  assert.ok(!s.clients.has(sock), 'not a live client yet');
  emitLive(s, 'LIVE1');
  emitLive(s, 'LIVE2');
  assert.deepStrictEqual(sock.writes, [], 'nothing written until the replay is ready');

  finish('REPLAY');
  await p;
  assert.deepStrictEqual(sock.writes, ['REPLAY', 'LIVE1', 'LIVE2'],
    'replay, then the queued live output in arrival order');
  assert.ok(s.clients.has(sock) && !s.pending.has(sock), 'now a normal live client');

  // Subsequent output flows straight through as a live client.
  emitLive(s, 'LIVE3');
  assert.deepStrictEqual(sock.writes, ['REPLAY', 'LIVE1', 'LIVE2', 'LIVE3']);
});

test('attachWithReplay: a socket dropped mid-reconstruction gets no replay and never joins clients', async () => {
  const s = fakeSession(['hist']);
  const sock = fakeSock();
  let finish;
  const reconstruct = () => new Promise(r => { finish = r; });
  const p = attachWithReplay(s, '1', sock, reconstruct);
  s.pending.delete(sock);   // drop()/onExit removed it while reconstructing
  finish('REPLAY');
  await p;
  assert.deepStrictEqual(sock.writes, [], 'no write to a socket that left mid-reconstruction');
  assert.ok(!s.clients.has(sock), 'never joined the live set');
});

test('attachWithReplay: reconstruction failure falls back to the raw byte-log', async () => {
  const s = fakeSession(['aaa', 'bbb']);
  const sock = fakeSock();
  const reconstruct = () => Promise.reject(new Error('boom'));
  await attachWithReplay(s, '1', sock, reconstruct);
  assert.deepStrictEqual(sock.writes, ['aaabbb'], 'raw log concatenated as the fallback');
  assert.ok(s.clients.has(sock), 'still joins as a live client after the fallback');
});

const previewSession = grid => ({ screen: { read: async () => (grid == null ? null : { grid }) } });

test('screenPreview: returns the last few rendered rows of the grid', async () => {
  const out = await screenPreview(previewSession('l1\nl2\nl3\nl4\nl5'));
  assert.deepStrictEqual(out, ['l3', 'l4', 'l5'], 'the bottom rows — what is on screen now');
});

test('screenPreview: hard-caps each row so a wide grid cannot bloat the reply', async () => {
  const out = await screenPreview(previewSession('x'.repeat(300)));
  assert.deepStrictEqual(out, ['x'.repeat(160)]);
});

test('screenPreview: an unreadable (exited mid-read) or empty grid yields []', async () => {
  assert.deepStrictEqual(await screenPreview(previewSession(null)), [], 'read() returned null -> []');
  assert.deepStrictEqual(await screenPreview(previewSession('')), [], 'blank grid -> [] (no phantom empty row)');
});
