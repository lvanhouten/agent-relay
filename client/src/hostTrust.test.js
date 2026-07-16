// Host-URL trust helpers. A scheme-less `host:port` shorthand must be
// normalized so it isn't misclassified as a remote host (and doesn't slip
// past the malformed-host guard).
import test from 'node:test';
import assert from 'node:assert';
import { normalizeHost, isLocalhost } from './hostTrust.js';

test('normalizeHost: prepends http:// to a scheme-less host:port', () => {
  assert.strictEqual(normalizeHost('localhost:3017'), 'http://localhost:3017');
  assert.strictEqual(normalizeHost('192.168.1.5:8080'), 'http://192.168.1.5:8080');
  assert.strictEqual(normalizeHost('relay.example.com'), 'http://relay.example.com');
});

test('normalizeHost: leaves an explicit scheme untouched', () => {
  assert.strictEqual(normalizeHost('http://localhost:3017'), 'http://localhost:3017');
  assert.strictEqual(normalizeHost('https://relay.example.com'), 'https://relay.example.com');
});

test('isLocalhost: a scheme-less localhost:port is trusted as loopback', () => {
  // new URL('localhost:3017') parses with an empty hostname — this shorthand
  // must be normalized explicitly or isLocalhost misses it as loopback.
  assert.strictEqual(isLocalhost('localhost:3017'), true);
  assert.strictEqual(isLocalhost('127.0.0.1:3017'), true);
  assert.strictEqual(isLocalhost('localhost'), true);
});

test('isLocalhost: explicit-scheme loopback still trusted', () => {
  assert.strictEqual(isLocalhost('http://localhost:3017'), true);
  assert.strictEqual(isLocalhost('http://127.0.0.1'), true);
});

test('isLocalhost: genuine remote hosts remain untrusted', () => {
  assert.strictEqual(isLocalhost('relay.example.com:3017'), false);
  assert.strictEqual(isLocalhost('http://evil.example.com'), false);
  assert.strictEqual(isLocalhost('10.0.0.7:3017'), false);
});
