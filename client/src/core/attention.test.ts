import test from 'node:test';
import assert from 'node:assert';
import { attentionFor, attentionRank } from './attention.ts';

// Pins the client half of the status vocabulary contract with
// server/src/sessions.js toDto(): every status the server emits for a LIVE
// line must decode to a deliberate dot/label, and anything else must render
// loud, not dead. A server-side rename now fails here instead of silently
// degrading on the card.

test('known statuses decode to their designed dot/label', () => {
  assert.deepStrictEqual(attentionFor('running'), { dot: 'online', label: 'running', pulse: false });
  assert.deepStrictEqual(attentionFor('idle'), { dot: 'idle', label: 'quiet', pulse: false });
  assert.deepStrictEqual(attentionFor('needs-input'), { dot: 'attention', label: 'needs input', pulse: true });
});

test('turn-done decodes to a distinct-color, non-pulsing dot', () => {
  const view = attentionFor('turn-done');
  assert.deepStrictEqual(view, { dot: 'done', label: 'turn done', pulse: false });
  // The distinctness from needs-input must be carried by dot variant (color),
  // never by pulse — pulse is disabled under prefers-reduced-motion and absent
  // in a static screenshot, so it can never be the only distinguisher.
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
  // Version skew (old bundle, newer server) must not render an urgent new
  // state as a dead-looking offline dot — that inverts the attention system.
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
