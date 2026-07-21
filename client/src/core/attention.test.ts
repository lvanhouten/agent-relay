import test from 'node:test';
import assert from 'node:assert';
import { attentionFor, attentionRank } from './attention.ts';

// Contract with server/sessions.js toDto(): unknown status renders loud, never silently dead.

test('known statuses decode to their designed dot/label', () => {
  assert.deepStrictEqual(attentionFor('running'), { dot: 'online', label: 'running', pulse: false });
  assert.deepStrictEqual(attentionFor('idle'), { dot: 'idle', label: 'quiet', pulse: false });
  assert.deepStrictEqual(attentionFor('needs-input'), { dot: 'attention', label: 'needs input', pulse: true });
});

test('turn-done decodes to a distinct-color, non-pulsing dot', () => {
  const view = attentionFor('turn-done');
  assert.deepStrictEqual(view, { dot: 'done', label: 'turn done', pulse: false });
  // Distinctness must ride the dot color, not pulse — pulse is off under reduced-motion and screenshots.
  const needsInput = attentionFor('needs-input');
  assert.notStrictEqual(view.dot, needsInput.dot);
  assert.strictEqual(view.pulse, false);
  assert.strictEqual(needsInput.pulse, true);
});

test('attentionRank orders needs-input > turn-done > everything else, which ties', () => {
  const ranks = {
    'needs-input': attentionRank('needs-input'),
    'turn-done': attentionRank('turn-done'),
    running: attentionRank('running'),
    idle: attentionRank('idle'),
  };
  assert.ok(ranks['needs-input'] < ranks['turn-done']);
  assert.ok(ranks['turn-done'] < ranks.running);
  assert.strictEqual(ranks.running, ranks.idle);
});

test('unknown status falls back loud: error dot, pulsing, raw status as label', () => {
  // Version skew (old bundle, new server) must not render an urgent status as a dead offline dot.
  const view = attentionFor('blocked-on-approval');
  assert.deepStrictEqual(view, { dot: 'error', label: 'blocked-on-approval', pulse: true });
});

test('unknown status warns once per value, not once per render', () => {
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
  try {
    attentionFor('mystery-state');
    attentionFor('mystery-state');
    attentionFor('other-mystery');
  } finally {
    console.warn = original;
  }
  assert.strictEqual(warnings.filter((w) => w.includes('mystery-state')).length, 1);
  assert.strictEqual(warnings.filter((w) => w.includes('other-mystery')).length, 1);
});
