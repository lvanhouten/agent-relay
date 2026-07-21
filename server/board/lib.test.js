'use strict';
// Secret round-trip/compare replace a pipe ACL Node can't set; tests use an injectable path, never the real %LOCALAPPDATA% secret.
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

// sendSecret must return false (write nothing) for a missing or truncated-empty secret file
// (writeFileSync truncates before writing) so callers retry instead of sending a broken secret.
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

// Cap matters: uncapped, a newline-less stream grows till V8's max-string RangeError crashes the daemon.

test('makeHandshake: a newline-less stream past the cap returns overflow, not unbounded growth', () => {
  const gate = makeHandshake('sekret', { cap: 16 });
  // Under the cap: still accumulating, no decision yet.
  assert.deepStrictEqual(gate.feed(Buffer.from('12345678')), { type: 'pending' });
  assert.deepStrictEqual(gate.feed(Buffer.from('9abcdefghij')), { type: 'overflow' });
});

test('makeHandshake: the real default cap is bounded well below any crash threshold', () => {
  const gate = makeHandshake('sekret');
  // MAX_PREAUTH_BYTES is a few KB, nowhere near V8's string limit; a blast at cap still overflows, not grows unbounded.
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

// Post-auth cap (pre-auth cap is makeHandshake, above) guards the same daemon-crash shape post-auth.
test('makeCommandBuffer: extracts complete newline-terminated command lines, keeps the tail', () => {
  const cmd = makeCommandBuffer();
  assert.deepStrictEqual(cmd.feed('{"cmd":"list"}\n{"cmd":"end"'), { lines: ['{"cmd":"list"}'], overflow: false });
  // the incomplete second line stays buffered until its newline arrives
  assert.deepStrictEqual(cmd.feed(',"id":"1"}\n'), { lines: ['{"cmd":"end","id":"1"}'], overflow: false });
});

test('makeCommandBuffer: an oversized newline-less command flags overflow instead of growing unbounded', () => {
  const cmd = makeCommandBuffer('', { cap: 16 });
  assert.strictEqual(cmd.feed('x'.repeat(10)).overflow, false);   // tail under the cap
  assert.strictEqual(cmd.feed('x'.repeat(10)).overflow, true);    // tail now 20 > 16 -> overflow
});

test('makeCommandBuffer: seeded leftover bytes are drained by feed("") right after auth', () => {
  // Mirrors board.js: a command bundled in the same chunk as the secret line is drained via feed('').
  const cmd = makeCommandBuffer('{"cmd":"list"}\n');
  assert.deepStrictEqual(cmd.feed(''), { lines: ['{"cmd":"list"}'], overflow: false });
});

test('makeCommandBuffer: the real default cap is bounded well below a crash threshold', () => {
  const cmd = makeCommandBuffer();
  assert.strictEqual(cmd.feed('x'.repeat(2 * 1024 * 1024)).overflow, true);
});
