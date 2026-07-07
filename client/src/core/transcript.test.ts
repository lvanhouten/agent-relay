import test from 'node:test';
import assert from 'node:assert';
import { transcriptFilename, stripAnsi } from './transcript.ts';

const ISO = '2026-07-06T14:30:00.123Z';

test('transcriptFilename: colons dashed, sub-second fraction dropped', () => {
  assert.strictEqual(transcriptFilename('build', ISO), 'build-2026-07-06T14-30-00Z.txt');
});

test('transcriptFilename: unsafe characters in the name collapse to dashes', () => {
  assert.strictEqual(
    transcriptFilename('feat/mobile answer', ISO),
    'feat-mobile-answer-2026-07-06T14-30-00Z.txt',
  );
});

test('transcriptFilename: leading/trailing dashes trimmed', () => {
  assert.strictEqual(transcriptFilename('  spaced  ', ISO), 'spaced-2026-07-06T14-30-00Z.txt');
});

test('transcriptFilename: an empty or all-unsafe name falls back to "session"', () => {
  assert.strictEqual(transcriptFilename('', ISO), 'session-2026-07-06T14-30-00Z.txt');
  assert.strictEqual(transcriptFilename('///', ISO), 'session-2026-07-06T14-30-00Z.txt');
});

test('stripAnsi: SGR color/attribute sequences drop, text survives', () => {
  assert.strictEqual(stripAnsi('\x1b[1;32mPASS\x1b[0m 12 tests'), 'PASS 12 tests');
});

test('stripAnsi: cursor-movement CSI and OSC title/hyperlink sequences drop', () => {
  assert.strictEqual(stripAnsi('\x1b[2J\x1b[H\x1b]0;my-title\x07ready'), 'ready');
  assert.strictEqual(stripAnsi('\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\'), 'link');
});

test('stripAnsi: plain text (including brackets and unicode) is untouched', () => {
  const plain = 'a [b] · ~/dev — 100%';
  assert.strictEqual(stripAnsi(plain), plain);
});
