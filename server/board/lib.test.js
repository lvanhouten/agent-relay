'use strict';
// Access-secret tests (the named-pipe read-disclosure fix). The secret helpers
// are the boundary that replaces a pipe security descriptor Node can't set, so
// the generate/persist/read round-trip and the constant-time compare get pinned
// here. writeBootSecret/readSecret take an injectable file path so the tests hit
// a scratch file, never the real per-user secret under %LOCALAPPDATA%.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { writeBootSecret, readSecret, secretEqual, sendSecret, makeHandshake, makeCommandBuffer, MAX_PREAUTH_BYTES } = require('./lib');

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-secret-'));
  return path.join(dir, 'board.test.secret');
}

test('writeBootSecret persists a high-entropy secret that readSecret returns verbatim', () => {
  const file = scratch();
  const secret = writeBootSecret(file);
  assert.ok(typeof secret === 'string' && secret.length >= 32, 'secret must carry real entropy');
  assert.strictEqual(readSecret(file), secret, 'round-trips through the file unchanged');
});

test('writeBootSecret generates a fresh secret each boot', () => {
  assert.notStrictEqual(writeBootSecret(scratch()), writeBootSecret(scratch()));
});

test('readSecret returns null when no secret file exists (board not up)', () => {
  assert.strictEqual(readSecret(path.join(os.tmpdir(), 'ar-nonexistent-' + process.pid)), null);
});

// sendSecret gates the handshake on the secret being READY on disk. The board
// persists its secret just after binding the pipe, so a client can
// connect in the gap before the file exists — or catch it empty, since
// writeFileSync truncates to 0 bytes before writing. Presenting an empty secret
// there gets the socket rejected+destroyed ("board closed the connection before
// replying") — the concurrent-load e2e flake. sendSecret must return false (and
// write nothing) so the caller retries instead.
function fakeSock() {
  const writes = [];
  return { writes, write(s) { writes.push(s); } };
}

test('sendSecret: absent secret (null) -> false, writes nothing (caller retries)', () => {
  const sock = fakeSock();
  assert.strictEqual(sendSecret(sock, () => null), false);
  assert.deepStrictEqual(sock.writes, []);
});

test('sendSecret: empty secret file (mid-write, "") -> false, writes nothing', () => {
  const sock = fakeSock();
  assert.strictEqual(sendSecret(sock, () => ''), false);
  assert.deepStrictEqual(sock.writes, []);
});

test('sendSecret: a present secret -> true, written with a trailing newline', () => {
  const sock = fakeSock();
  assert.strictEqual(sendSecret(sock, () => 'abc123'), true);
  assert.deepStrictEqual(sock.writes, ['abc123\n']);
});

test('secretEqual: exact match only, constant-time-safe on type/length', () => {
  const s = writeBootSecret(scratch());
  assert.strictEqual(secretEqual(s, s), true);
  assert.strictEqual(secretEqual(s, s + 'x'), false);
  assert.strictEqual(secretEqual('', s), false);
  assert.strictEqual(secretEqual(null, s), false);
  assert.strictEqual(secretEqual(s, null), false);
});

// --- makeHandshake: the shared pre-auth handshake for both pipe planes ---
// The cap matters: without it, a newline-less stream grows the accumulator until
// V8's max-string-length RangeError throws inside the 'data' listener and crashes
// the whole daemon.

test('makeHandshake (C1): a newline-less stream past the cap returns overflow, not unbounded growth', () => {
  const gate = makeHandshake('sekret', { cap: 16 });
  // Under the cap: still accumulating, no decision yet.
  assert.deepStrictEqual(gate.feed(Buffer.from('12345678')), { type: 'pending' });
  // Crossing the cap with still no newline: the caller is told to destroy the
  // socket instead of letting the string grow toward the RangeError crash.
  assert.deepStrictEqual(gate.feed(Buffer.from('9abcdefghij')), { type: 'overflow' });
});

test('makeHandshake (C1): the real default cap is bounded well below any crash threshold', () => {
  const gate = makeHandshake('sekret');
  // A big newline-less blast at the production cap still overflows (does not grow
  // without limit). MAX_PREAUTH_BYTES is a few KB, nowhere near V8's string limit.
  assert.strictEqual(gate.feed(Buffer.from('x'.repeat(MAX_PREAUTH_BYTES + 1))).type, 'overflow');
});

test('makeHandshake: a matching secret accepts and hands back the bytes after the newline', () => {
  const gate = makeHandshake('sekret');
  const r = gate.feed(Buffer.from('sekret\nhello world'));
  assert.deepStrictEqual(r, { type: 'accept', rest: 'hello world' });
});

test('makeHandshake: a trailing \\r on the secret line is stripped before the compare', () => {
  const gate = makeHandshake('sekret');
  assert.strictEqual(gate.feed(Buffer.from('sekret\r\nrest')).type, 'accept');
});

test('makeHandshake: a wrong secret rejects', () => {
  const gate = makeHandshake('sekret');
  assert.deepStrictEqual(gate.feed(Buffer.from('nope\n')), { type: 'reject' });
});

test('makeHandshake: the secret line may arrive split across multiple chunks', () => {
  const gate = makeHandshake('sekret');
  assert.deepStrictEqual(gate.feed(Buffer.from('sek')), { type: 'pending' });
  assert.deepStrictEqual(gate.feed(Buffer.from('ret')), { type: 'pending' });
  assert.deepStrictEqual(gate.feed(Buffer.from('\n')), { type: 'accept', rest: '' });
});

// --- makeCommandBuffer: the post-auth control-plane accumulator + cap. The
// pre-auth cap lives in makeHandshake above; this is the other daemon-crash shape
// — an oversized newline-less command from an already-authed client.
test('makeCommandBuffer: extracts complete newline-terminated command lines, keeps the tail', () => {
  const cmd = makeCommandBuffer();
  assert.deepStrictEqual(cmd.feed('{"cmd":"list"}\n{"cmd":"end"'), { lines: ['{"cmd":"list"}'], overflow: false });
  // the incomplete second line stays buffered until its newline arrives
  assert.deepStrictEqual(cmd.feed(',"id":"1"}\n'), { lines: ['{"cmd":"end","id":"1"}'], overflow: false });
});

test('makeCommandBuffer (C1): an oversized newline-less command flags overflow instead of growing unbounded', () => {
  const cmd = makeCommandBuffer('', { cap: 16 });
  assert.strictEqual(cmd.feed('x'.repeat(10)).overflow, false);   // tail under the cap
  assert.strictEqual(cmd.feed('x'.repeat(10)).overflow, true);    // tail now 20 > 16 -> overflow
});

test('makeCommandBuffer: seeded leftover bytes are drained by feed("") right after auth', () => {
  // mirrors board.js: makeCommandBuffer(r.rest) then feed('') to run a command
  // that arrived bundled in the same chunk as the secret line.
  const cmd = makeCommandBuffer('{"cmd":"list"}\n');
  assert.deepStrictEqual(cmd.feed(''), { lines: ['{"cmd":"list"}'], overflow: false });
});

test('makeCommandBuffer (C1): the real default cap is bounded well below a crash threshold', () => {
  const cmd = makeCommandBuffer();
  assert.strictEqual(cmd.feed('x'.repeat(2 * 1024 * 1024)).overflow, true);
});
