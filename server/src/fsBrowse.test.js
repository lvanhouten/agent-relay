'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { browseDir, ENTRY_CAP } = require('./fsBrowse');

let root;

before(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fsbrowse-'));
  // Mixed-case dirs to prove case-insensitive sort; a file that must not appear.
  await fs.promises.mkdir(path.join(root, 'Bravo'));
  await fs.promises.mkdir(path.join(root, 'alpha'));
  await fs.promises.mkdir(path.join(root, 'Charlie'));
  await fs.promises.writeFile(path.join(root, 'afile.txt'), 'x');
});

after(async () => {
  await fs.promises.rm(root, { recursive: true, force: true });
});

test('lists directories only, sorted case-insensitively', async () => {
  const res = await browseDir(root);
  assert.equal(res.error, undefined);
  assert.deepEqual(res.entries.map((e) => e.name), ['alpha', 'Bravo', 'Charlie']);
  assert.ok(res.entries.every((e) => e.isDir === true));
});

test('excludes files', async () => {
  const res = await browseDir(root);
  assert.ok(!res.entries.some((e) => e.name === 'afile.txt'));
});

test('parent is the lexical dirname of a normal directory', async () => {
  const res = await browseDir(root);
  assert.equal(res.parent, path.dirname(path.resolve(root)));
});

test('parent is null at a filesystem root', async () => {
  const rootPath = path.parse(path.resolve(root)).root; // C:\ or /
  const res = await browseDir(rootPath);
  assert.equal(res.parent, null);
});

test('resolved path is absolute and normalized', async () => {
  const res = await browseDir(root);
  assert.equal(res.path, path.resolve(root));
});

test('a nonexistent path returns not-found, not a throw', async () => {
  const res = await browseDir(path.join(root, 'does-not-exist'));
  assert.equal(res.error, 'not-found');
  assert.equal(res.entries, undefined);
});

test('a file path returns not-a-directory', async () => {
  const res = await browseDir(path.join(root, 'afile.txt'));
  assert.equal(res.error, 'not-a-directory');
});

test('blank/undefined input falls back to home', async () => {
  const res = await browseDir(undefined);
  assert.equal(res.path, path.resolve(os.homedir()));
});

test('caps entries and flags truncation', async () => {
  const big = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fsbrowse-big-'));
  try {
    await Promise.all(
      Array.from({ length: ENTRY_CAP + 5 }, (_, i) =>
        fs.promises.mkdir(path.join(big, `d${String(i).padStart(4, '0')}`))
      )
    );
    const res = await browseDir(big);
    assert.equal(res.entries.length, ENTRY_CAP);
    assert.equal(res.truncated, true);
  } finally {
    await fs.promises.rm(big, { recursive: true, force: true });
  }
});

test('does not flag truncation when under the cap', async () => {
  const res = await browseDir(root);
  assert.equal(res.truncated, false);
});
