// getPairing() wrapper (brief 10). Stubs global.fetch — node --test runs each
// file in its own process, so this stub can't leak into other test files.
import test from 'node:test';
import assert from 'node:assert';
import { getPairing } from './api.ts';

function stubFetch(response: { ok: boolean; status: number; json?: () => unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return response as unknown as Response;
  };
  return calls;
}

test('getPairing: resolves the parsed body on a 200', async () => {
  const body = { tunnel: { state: 'up', reason: null }, pairingUrl: 'https://x/#token=t' };
  stubFetch({ ok: true, status: 200, json: async () => body });
  const info = await getPairing();
  assert.deepStrictEqual(info, body);
});

test('getPairing: hits GET /api/pairing with no Authorization header (cookie-authed)', async () => {
  const calls = stubFetch({
    ok: true,
    status: 200,
    json: async () => ({ tunnel: { state: 'disabled', reason: null }, pairingUrl: null }),
  });
  await getPairing();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, '/api/pairing');
  const h = calls[0].init?.headers as Record<string, string>;
  assert.strictEqual('Authorization' in h, false);
});

test('getPairing: rejects on a non-ok response (401 / network-adjacent failures)', async () => {
  stubFetch({ ok: false, status: 401 });
  await assert.rejects(() => getPairing());
});
