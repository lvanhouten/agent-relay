import test from 'node:test';
import assert from 'node:assert';
import { transcriptFilename } from './transcript.ts';

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
