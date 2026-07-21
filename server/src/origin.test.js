'use strict';
// Origin policy is the only guard against a drive-by page when
// AR_NO_AUTH=1 — every branch is pinned here.
const test = require('node:test');
const assert = require('node:assert');
const { originAllowed, parseAllowlist, allowRuntimeOrigin } = require('./origin');

const HOST = 'machine.tailnet:3017';

test('no Origin header (non-browser client) is allowed', () => {
  assert.strictEqual(originAllowed(undefined, HOST, []), true);
  assert.strictEqual(originAllowed('', HOST, []), true);
});

test('loopback origins are allowed regardless of port', () => {
  assert.strictEqual(originAllowed('http://localhost:5173', HOST, []), true);
  assert.strictEqual(originAllowed('http://127.0.0.1:9999', HOST, []), true);
  assert.strictEqual(originAllowed('http://[::1]:5173', HOST, []), true);
});

test('same-origin (Origin host equals the request Host) is allowed', () => {
  assert.strictEqual(originAllowed('http://machine.tailnet:3017', HOST, []), true);
  assert.strictEqual(originAllowed('https://relay.example.com', 'relay.example.com', []), true);
});

test('a cross-origin page is denied by default', () => {
  assert.strictEqual(originAllowed('https://evil.example', HOST, []), false);
  // near-miss: same hostname, different port is NOT same-origin
  assert.strictEqual(originAllowed('http://machine.tailnet:9999', HOST, []), false);
});

test('Origin "null" (sandboxed iframe / file://) is denied', () => {
  assert.strictEqual(originAllowed('null', HOST, []), false);
});

test('an unparseable Origin is denied', () => {
  assert.strictEqual(originAllowed('not a url', HOST, []), false);
});

test('the AR_CORS_ORIGIN allowlist admits exact origins only', () => {
  const list = parseAllowlist('https://relay.example.com, https://other.example');
  assert.strictEqual(originAllowed('https://relay.example.com', HOST, list), true);
  assert.strictEqual(originAllowed('https://other.example', HOST, list), true);
  assert.strictEqual(originAllowed('https://relay.example.com.evil.net', HOST, list), false);
});

test('parseAllowlist tolerates whitespace and empty entries', () => {
  assert.deepStrictEqual(parseAllowlist(' a.com ,, b.com '), ['a.com', 'b.com']);
  assert.deepStrictEqual(parseAllowlist(undefined), []);
});

// A tunneled page's Origin must pass even when the Host header is unrelated —
// must not rely on the proxy preserving Host passthrough.
test('a runtime-registered tunnel origin passes with a mismatched Host header (pin test)', () => {
  allowRuntimeOrigin('https://machine.tailnet.ts.net');
  assert.strictEqual(
    originAllowed('https://machine.tailnet.ts.net', '127.0.0.1:3017', []),
    true
  );
});

test('registration is additive to, not a replacement for, the static allowlist', () => {
  const list = parseAllowlist('https://relay.example.com');
  allowRuntimeOrigin('https://runtime.example.com');
  assert.strictEqual(originAllowed('https://relay.example.com', HOST, list), true);
  assert.strictEqual(originAllowed('https://runtime.example.com', HOST, list), true);
});

test('registration is idempotent (registering twice does not change behavior)', () => {
  allowRuntimeOrigin('https://idempotent.example.net');
  allowRuntimeOrigin('https://idempotent.example.net');
  assert.strictEqual(originAllowed('https://idempotent.example.net', HOST, []), true);
});

test('unregistered non-loopback, non-same-origin, non-allowlisted origins still fail', () => {
  assert.strictEqual(originAllowed('https://not-registered.example', HOST, []), false);
});

test('originAllowed accepts an injected runtimeOrigins set, independent of the module-level one', () => {
  const injected = new Set(['https://injected.example']);
  assert.strictEqual(originAllowed('https://injected.example', HOST, [], injected), true);
  assert.strictEqual(originAllowed('https://injected.example', HOST, [], new Set()), false);
});
