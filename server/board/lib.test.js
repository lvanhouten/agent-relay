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
const { writeBootSecret, readSecret, secretEqual } = require('./lib');

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

test('secretEqual: exact match only, constant-time-safe on type/length', () => {
  const s = writeBootSecret(scratch());
  assert.strictEqual(secretEqual(s, s), true);
  assert.strictEqual(secretEqual(s, s + 'x'), false);
  assert.strictEqual(secretEqual('', s), false);
  assert.strictEqual(secretEqual(null, s), false);
  assert.strictEqual(secretEqual(s, null), false);
});
