import test from 'node:test';
import assert from 'node:assert';
import { attentionFor } from './attention.ts';

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
