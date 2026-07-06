// decideBoot's branching, proven against stub deps — no fetch/window
// involved (that wiring lives in App.jsx). See boot.ts for the contract.
import test from 'node:test';
import assert from 'node:assert';
import { decideBoot, STALE_PAIRING_ERROR } from './boot.ts';

test('fragment token + successful login -> sessions, probe never called', async () => {
  let probeCalled = false;
  const outcome = await decideBoot('abc123', {
    login: async (token) => { assert.strictEqual(token, 'abc123'); return true; },
    probe: async () => { probeCalled = true; return true; },
  });
  assert.deepStrictEqual(outcome, { screen: 'sessions' });
  assert.strictEqual(probeCalled, false);
});

test('fragment token + failed login (rotated/stale) -> login screen with stale-pairing error', async () => {
  const outcome = await decideBoot('stale-token', {
    login: async () => false,
    probe: async () => { throw new Error('probe must not be called'); },
  });
  assert.deepStrictEqual(outcome, { screen: 'login', error: STALE_PAIRING_ERROR });
});

test('no fragment + ambient cookie authenticates -> sessions, login never called', async () => {
  let loginCalled = false;
  const outcome = await decideBoot(null, {
    login: async () => { loginCalled = true; return true; },
    probe: async () => true,
  });
  assert.deepStrictEqual(outcome, { screen: 'sessions' });
  assert.strictEqual(loginCalled, false);
});

test('no fragment + no ambient cookie -> login screen, no error', async () => {
  const outcome = await decideBoot(null, {
    login: async () => true,
    probe: async () => false,
  });
  assert.deepStrictEqual(outcome, { screen: 'login' });
  assert.strictEqual('error' in outcome, false);
});
