import test from 'node:test';
import assert from 'node:assert';
import { pairingDisplay } from './pairingDisplay.ts';
import type { PairingInfo } from './types.ts';

test('tunnel up -> shows QR, no message', () => {
  const info: PairingInfo = {
    tunnel: { state: 'up', reason: null },
    pairingUrl: 'https://box.tail1234.ts.net/#token=abc',
  };
  const d = pairingDisplay(info);
  assert.strictEqual(d.showQr, true);
  assert.strictEqual(d.message, null);
});

test('tunnel down -> no QR, surfaces the endpoint reason verbatim', () => {
  const reason = 'Tailscale is installed but not logged in. Run "tailscale up" to log in.';
  const info: PairingInfo = { tunnel: { state: 'down', reason }, pairingUrl: null };
  const d = pairingDisplay(info);
  assert.strictEqual(d.showQr, false);
  assert.strictEqual(d.message, reason);
});

test('tunnel down with no reason -> falls back to a generic message rather than blank', () => {
  const info: PairingInfo = { tunnel: { state: 'down', reason: null }, pairingUrl: null };
  const d = pairingDisplay(info);
  assert.strictEqual(d.showQr, false);
  assert.ok(d.message && d.message.length > 0);
});

test('tunnel disabled -> no QR, names AR_TUNNEL', () => {
  const info: PairingInfo = { tunnel: { state: 'disabled', reason: null }, pairingUrl: null };
  const d = pairingDisplay(info);
  assert.strictEqual(d.showQr, false);
  assert.ok(d.message && d.message.includes('AR_TUNNEL'));
});

test('unrecognized state -> no QR, does not throw (forward-compat)', () => {
  const info = { tunnel: { state: 'weird', reason: 'x' }, pairingUrl: null } as unknown as PairingInfo;
  const d = pairingDisplay(info);
  assert.strictEqual(d.showQr, false);
  assert.ok(d.heading.includes('weird'));
});
