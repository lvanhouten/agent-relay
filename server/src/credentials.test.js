'use strict';
// loadCredentials is pure over an injected env/path, so persistence is
// tested against a temp dir, never the real %LOCALAPPDATA%\agent-relay\ path.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadCredentials } = require('./credentials');

function tempFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-credentials-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'nested', 'credentials.json'); // dir doesn't exist yet
}

test('AR_TOKEN set: returns the pinned token; token is not written, signing secret is persisted', t => {
  const file = tempFile(t);
  const result = loadCredentials({ AR_TOKEN: 'pinned-value' }, file);
  assert.strictEqual(result.token, 'pinned-value');
  assert.strictEqual(result.generated, false);
  assert.ok(typeof result.signingSecret === 'string' && result.signingSecret.length > 0);

  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.notStrictEqual(onDisk.token, 'pinned-value', 'pinned token must never be written to disk');
  assert.strictEqual(onDisk.signingSecret, result.signingSecret, 'signing secret is still persisted');

  // Reusing the file (still AR_TOKEN) must reuse the same signing secret.
  const second = loadCredentials({ AR_TOKEN: 'pinned-value' }, file);
  assert.strictEqual(second.signingSecret, result.signingSecret);
});

test('AR_NO_AUTH=1: token is null, signing secret is still resolved', t => {
  const file = tempFile(t);
  const result = loadCredentials({ AR_NO_AUTH: '1' }, file);
  assert.strictEqual(result.token, null);
  assert.strictEqual(result.generated, false);
  assert.ok(typeof result.signingSecret === 'string' && result.signingSecret.length > 0);
});

test('neither set: first load generates + persists; second load returns identical values with generated:false', t => {
  const file = tempFile(t);
  const first = loadCredentials({}, file);
  assert.ok(typeof first.token === 'string' && first.token.length >= 32, 'token must have real entropy');
  assert.strictEqual(first.generated, true);

  const second = loadCredentials({}, file);
  assert.strictEqual(second.token, first.token);
  assert.strictEqual(second.signingSecret, first.signingSecret);
  assert.strictEqual(second.generated, false);
});

test('deleting the file between loads rotates both token and signing secret', t => {
  const file = tempFile(t);
  const first = loadCredentials({}, file);
  fs.rmSync(file);
  const second = loadCredentials({}, file);
  assert.notStrictEqual(second.token, first.token);
  assert.notStrictEqual(second.signingSecret, first.signingSecret);
  assert.strictEqual(second.generated, true);
});

test('a corrupt file regenerates instead of throwing', t => {
  const file = tempFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not json { at all ]]] garbage bytes \x00\x01');

  let result;
  assert.doesNotThrow(() => { result = loadCredentials({}, file); });
  assert.ok(typeof result.token === 'string' && result.token.length >= 32);
  assert.strictEqual(result.generated, true);
});

test('the file is written with owner-only mode into a directory created on demand', t => {
  const file = tempFile(t);
  assert.strictEqual(fs.existsSync(path.dirname(file)), false, 'precondition: nested dir does not yet exist');

  loadCredentials({}, file);

  assert.ok(fs.existsSync(file));
  if (process.platform !== 'win32') {
    const mode = fs.statSync(file).mode & 0o777;
    assert.strictEqual(mode, 0o600);
  }
});
