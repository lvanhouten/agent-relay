'use strict';
// Pane-spawn decision + RPC-reply signal tests. Covers N7's residual / new-N1:
// openPane's refusal must be visible to the caller (paneOpened in the reply), not
// just logged. Uses the pure helpers so no pty/process is launched.
const test = require('node:test');
const assert = require('node:assert');
const { paneSpawnDecision, openPane, handle, notifyClientsClosed, makeRunFeeder, bringOnline } = require('./board');

test('paneSpawnDecision: a standalone {cmd} arg is spawnable', () => {
  const d = paneSpawnDecision({ file: 'wezterm', args: ['cli', 'spawn', '--', '{cmd}'] });
  assert.strictEqual(d.standalone, true);
  assert.strictEqual(d.embedded, false);
});

test('paneSpawnDecision: {cmd} embedded in a larger string is refused (N7)', () => {
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

test('openPane: returns false (no process) when the recipe is refused (new-N1)', () => {
  const opened = openPane('99', { file: 'sh', args: ['-c', "'{cmd}'"] });
  assert.strictEqual(opened, false);
});

// handle('join') on a nonexistent line never touches a pty — safe to exercise the
// reply-building. paneOpened must be present so the caller can tell.
function capture() {
  const chunks = [];
  return { sock: { write: s => chunks.push(s) }, reply: () => JSON.parse(chunks.join('')) };
}

test('join reply for a missing line reports ok:false and paneOpened:null (new-N1)', () => {
  const c = capture();
  handle({ cmd: 'join', id: 'no-such-line' }, c.sock);
  const r = c.reply();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.paneOpened, null, 'no pane attempted for a missing line');
  assert.ok('paneOpened' in r, 'the field is present so callers can branch on it');
});

// N10: a throwing client .end() in the line-exit path must not abort the loop or
// propagate out (it runs in an async pty callback, uncaught == daemon down).
test('notifyClientsClosed (N10): a throwing client does not abort the others or propagate', () => {
  const notified = [];
  const good = suffix => ({ end: f => notified.push(suffix + f) });
  const bad = { end: () => { throw new Error('socket in a bad state'); } };
  const clients = new Set([good('a:'), bad, good('b:')]);
  assert.doesNotThrow(() => notifyClientsClosed(clients, 'BYE'));
  assert.deepStrictEqual(notified, ['a:BYE', 'b:BYE'], 'both healthy clients still notified');
});

// --- bringOnline: C2, the write-then-listen ordering that desyncs the secret ---
// The fix: persist the secret ONLY from the bind-success callback, so a process
// that loses the control-pipe bind race never overwrites the winner's on-disk
// secret. These pin the ordering invariant without binding a real pipe.

test('bringOnline (C2): persists the secret ONLY after the bind succeeds, never before', () => {
  const calls = [];
  let bindCb = null;
  bringOnline({
    generate: () => 'SEKRET',
    assign: s => calls.push(['assign', s]),
    listen: cb => { calls.push(['listen']); bindCb = cb; },  // bind not confirmed yet
    persist: s => calls.push(['persist', s]),
    ready: () => calls.push(['ready']),
  });
  // Before the OS confirms the bind, the secret is set in memory + listen is
  // attempted, but NOTHING is written to disk — the old code wrote it here.
  assert.deepStrictEqual(calls, [['assign', 'SEKRET'], ['listen']],
    'no persist before the bind-success callback fires');
  bindCb();  // this process won the pipe
  assert.deepStrictEqual(calls,
    [['assign', 'SEKRET'], ['listen'], ['persist', 'SEKRET'], ['ready']],
    'secret persisted only inside the bind-success callback');
});

test('bringOnline (C2): a process that LOSES the bind race never persists the secret', () => {
  const calls = [];
  bringOnline({
    generate: () => 'LOSER',
    assign: s => calls.push(['assign', s]),
    // Bind fails (EADDRINUSE): the success callback is never invoked; the real
    // 'error' handler calls process.exit(0).
    listen: () => { calls.push(['listen']); },
    persist: s => calls.push(['persist', s]),
  });
  assert.ok(!calls.some(c => c[0] === 'persist'),
    "the losing process must never overwrite the winner's on-disk secret");
});

// --- makeRunFeeder: initial-command feed debounce + confirm-and-retry ---
// A fake clock + scheduler so the timing logic is exercised deterministically
// without a real pty or wall-clock waits. advance(ms) fires due timers (including
// ones scheduled by a firing callback) in due order.
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
