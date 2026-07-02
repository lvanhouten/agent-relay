'use strict';
// Cursor-cache unit tests for mcp-server.js's read-output bookkeeping. These
// cover the three C1 sub-defects + the W2 false-positive + the N2 TTL, without a
// live board (the pure decision logic is factored out of the pipe I/O).
const test = require('node:test');
const assert = require('node:assert');
const mcp = require('./mcp-server');

test.beforeEach(() => mcp.__resetBoot());

// --- advanceCursor: the pure decision the read path makes on each finish() ---

test('advanceCursor: monotonic advance returns prior cursor and never rolls back', () => {
  const cache = new Map();
  // first read of 100 chars: nothing seen yet
  assert.strictEqual(mcp.advanceCursor(cache, 'b1:1', 100, false), 0);
  assert.strictEqual(cache.get('b1:1'), 100);
  // a concurrent read that observed fewer chars must NOT roll the cursor back
  assert.strictEqual(mcp.advanceCursor(cache, 'b1:1', 40, false), 100);
  assert.strictEqual(cache.get('b1:1'), 100, 'cursor stays at the high-water mark');
  // a later read that saw more advances it
  assert.strictEqual(mcp.advanceCursor(cache, 'b1:1', 250, false), 100);
  assert.strictEqual(cache.get('b1:1'), 250);
});

// W2: the cursor must be dropped ONLY when the pipe actually closed, never
// because the stream text happened to contain the farewell substring.
test('advanceCursor (W2): live output containing "closed (exit 0)" does NOT drop the cursor', () => {
  const cache = new Map();
  // A running program echoes the farewell phrase, but the pipe is still open.
  mcp.advanceCursor(cache, 'b1:1', 500, /* pipeClosed */ false);
  assert.strictEqual(cache.has('b1:1'), true, 'cursor survives while the line is alive');
  // Only an actual pipe close drops it.
  mcp.advanceCursor(cache, 'b1:1', 600, /* pipeClosed */ true);
  assert.strictEqual(cache.has('b1:1'), false, 'cursor dropped when the line actually ended');
});

// C1 sub-defect 3: an unconfirmed nonce (null key) must never touch the cache.
test('advanceCursor (C1 re-corruption): null key neither reads nor writes the cache', () => {
  const cache = new Map();
  cache.set('stale:1', 999); // an orphaned pre-restart entry
  const already = mcp.advanceCursor(cache, null, 300, false);
  assert.strictEqual(already, 0, 'no cursor consulted under an unconfirmed nonce');
  assert.strictEqual(cache.get('stale:1'), 999, 'orphaned entry left untouched — no collision');
  assert.strictEqual(cache.size, 1, 'nothing written under a null key');
});

// --- forgetLine: C1 sub-defect 1, the end_line leak ---

test('forgetLine (C1 leak): drops every cursor for an id across all boot nonces', () => {
  mcp.seen.set('bootA:7', 10);
  mcp.seen.set('bootB:7', 20);   // same id, a previous board
  mcp.seen.set('bootA:8', 30);   // a different line — must survive
  mcp.forgetLine('7');
  assert.strictEqual(mcp.seen.has('bootA:7'), false);
  assert.strictEqual(mcp.seen.has('bootB:7'), false);
  assert.strictEqual(mcp.seen.has('bootA:8'), true, 'unrelated line untouched');
});

test('forgetLine: matches the full id, not a suffix (":17" is not forgotten by "7")', () => {
  mcp.seen.set('bootA:7', 10);
  mcp.seen.set('bootA:17', 10);
  mcp.forgetLine('7');
  assert.strictEqual(mcp.seen.has('bootA:7'), false);
  assert.strictEqual(mcp.seen.has('bootA:17'), true, 'id 17 must not be caught by forgetLine("7")');
});

// --- refreshBoot: the confirmed/unconfirmed contract + N2 TTL ---

test('refreshBoot: a failed probe returns confirmed:false (caller must skip the cache)', async () => {
  mcp.__setRpc(async () => { throw new Error('board down'); });
  const r = await mcp.refreshBoot();
  assert.strictEqual(r.confirmed, false);
});

test('refreshBoot: a successful probe confirms the nonce and clears cache on change', async () => {
  mcp.seen.set('old:1', 5);
  mcp.__setRpc(async () => ({ ok: true, boot: 'nonceX', lines: [] }));
  const r = await mcp.refreshBoot();
  assert.strictEqual(r.confirmed, true);
  assert.strictEqual(r.boot, 'nonceX');
  assert.strictEqual(mcp.seen.has('old:1'), false, 'cache cleared on a boot-nonce change');
});

test('refreshBoot (N2): a fresh confirmed nonce is reused without a new round-trip', async () => {
  let calls = 0;
  mcp.__setRpc(async () => { calls++; return { ok: true, boot: 'nonceX', lines: [] }; });
  await mcp.refreshBoot();
  await mcp.refreshBoot();
  await mcp.refreshBoot();
  assert.strictEqual(calls, 1, 'subsequent reads inside the TTL do not re-probe the board');
});

// --- observeBoot: the round-2 regression — TTL trust with no live signal ---

test('observeBoot (C1 re-corruption, round 2): a fresh boot observed via new/list invalidates a stale entry immediately, independent of the read-path TTL', () => {
  mcp.observeBoot('A');           // refreshBoot's TTL is now "confirmed" fresh under A
  mcp.seen.set('A:3', 999);       // an orphaned pre-restart entry for a reused id
  mcp.observeBoot('B');           // e.g. a switchboard_new_line reply after a restart
  assert.strictEqual(mcp.seen.has('A:3'), false, 'stale entry dropped the instant a different boot is observed');
  assert.strictEqual(mcp.seen.size, 0);
});

test('observeBoot: repeating the same boot value is a no-op — must not wipe live cursors', () => {
  mcp.observeBoot('A');
  mcp.seen.set('A:3', 999);
  mcp.observeBoot('A');
  assert.strictEqual(mcp.seen.get('A:3'), 999, 'same-boot observation must not clear an unrelated live cursor');
});

test('observeBoot: a falsy boot (a failed RPC reply) is ignored, not treated as a change', () => {
  mcp.observeBoot('A');
  mcp.seen.set('A:3', 999);
  mcp.observeBoot(undefined);
  assert.strictEqual(mcp.seen.get('A:3'), 999, 'an RPC failure must not corrupt the cache');
});

// --- endLine: the round-2 regression — end_line's leak path still had no try/finally ---

test('endLine (C1 leak, round 2): forgets the cursor even when the end RPC rejects', async () => {
  mcp.seen.set('bootA:9', 42);
  mcp.__setRpc(async () => { throw new Error('board unreachable'); });
  await assert.rejects(() => mcp.endLine('9'), /board unreachable/);
  assert.strictEqual(mcp.seen.has('bootA:9'), false, 'cursor dropped despite the failed end RPC');
});

test('endLine: forgets the cursor on a successful end too, and returns the RPC reply', async () => {
  mcp.seen.set('bootA:9', 42);
  mcp.__setRpc(async () => ({ ok: true }));
  const r = await mcp.endLine('9');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(mcp.seen.has('bootA:9'), false);
});

// --- framePayload: the send-input byte string (bracketed-paste framing) ---

const PS = '\x1b[200~', PE = '\x1b[201~';

test('framePayload: default appends Enter, sends text verbatim (per-line submit preserved)', () => {
  assert.strictEqual(mcp.framePayload('npm test', { submit: true }), 'npm test\r');
  // a multi-line value is untouched — each embedded newline still submits its line
  assert.strictEqual(mcp.framePayload('echo one\necho two', { submit: true }), 'echo one\necho two\r');
});

test('framePayload: submit:false omits the trailing Enter', () => {
  assert.strictEqual(mcp.framePayload('partial', { submit: false }), 'partial');
});

test('framePayload: paste wraps in bracketed-paste markers, then Enter when submit', () => {
  assert.strictEqual(mcp.framePayload('a\nb', { submit: true, paste: true }), `${PS}a\nb${PE}\r`);
  assert.strictEqual(mcp.framePayload('a\nb', { submit: false, paste: true }), `${PS}a\nb${PE}`);
});

test('framePayload: paste strips stray paste markers in text so the framing stays well-formed', () => {
  const evil = `x${PE}y${PS}z`;
  assert.strictEqual(mcp.framePayload(evil, { submit: false, paste: true }), `${PS}xyz${PE}`);
});

test('framePayload: defaults (no opts) submit with Enter, no paste', () => {
  assert.strictEqual(mcp.framePayload('hi'), 'hi\r');
});
