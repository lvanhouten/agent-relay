import test from 'node:test';
import assert from 'node:assert';
import { KEY_CHIPS, composerBytes } from './keyChips.ts';

test('KEY_CHIPS: control keys carry their raw sequences', () => {
  const byLabel = Object.fromEntries(KEY_CHIPS.map((c) => [c.label, c.seq]));
  assert.strictEqual(byLabel['Enter'], '\r');
  assert.strictEqual(byLabel['Esc'], '\x1b');
  assert.strictEqual(byLabel['Ctrl+C'], '\x03');
  assert.strictEqual(byLabel['Tab'], '\t');
});

test('KEY_CHIPS: arrows use the CSI cursor sequences', () => {
  const byLabel = Object.fromEntries(KEY_CHIPS.map((c) => [c.label, c.seq]));
  assert.strictEqual(byLabel['↑'], '\x1b[A');
  assert.strictEqual(byLabel['↓'], '\x1b[B');
  assert.strictEqual(byLabel['←'], '\x1b[D');
  assert.strictEqual(byLabel['→'], '\x1b[C');
});

test('KEY_CHIPS: letter/digit chips send the bare char with no trailing Enter', () => {
  // Chips send one raw key; an added auto-submit \r here would double-fire digit menus (pinned).
  for (const label of ['y', 'n', 'x', '1', '2', '3']) {
    const chip = KEY_CHIPS.find((c) => c.label === label);
    assert.ok(chip, `missing chip ${label}`);
    assert.strictEqual(chip!.seq, label);
  }
});

test('composerBytes: single-line input gets a trailing carriage return to submit', () => {
  assert.strictEqual(composerBytes('yes'), 'yes\r');
  assert.strictEqual(composerBytes(''), '\r');
});

test('composerBytes: multi-line text is wrapped in a bracketed-paste envelope, no trailing CR', () => {
  assert.strictEqual(composerBytes('a\nb'), '\x1b[200~a\nb\x1b[201~');
});
