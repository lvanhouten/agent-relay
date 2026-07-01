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
