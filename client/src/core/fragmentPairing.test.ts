// Fragment-token parsing for the QR-pairing handoff; stays window-free so it's pure and unit-testable.
import test from 'node:test';
import assert from 'node:assert';
import { readFragmentToken, stripFragment } from './fragmentPairing.ts';

test('readFragmentToken: #token=<value> extracts the value', () => {
  assert.strictEqual(readFragmentToken('#token=abc123'), 'abc123');
});

test('readFragmentToken: leading "#" is optional in the input contract', () => {
  assert.strictEqual(readFragmentToken('token=abc123'), 'abc123');
});

test('readFragmentToken: empty string returns null', () => {
  assert.strictEqual(readFragmentToken(''), null);
});

test('readFragmentToken: bare "#" returns null', () => {
  assert.strictEqual(readFragmentToken('#'), null);
});

test('readFragmentToken: a different fragment key returns null', () => {
  assert.strictEqual(readFragmentToken('#other=x'), null);
});

test('readFragmentToken: an empty token value returns null', () => {
  assert.strictEqual(readFragmentToken('#token='), null);
});

test('readFragmentToken: percent-encoded tokens round-trip', () => {
  const encoded = encodeURIComponent('abc-123_XYZ~');
  assert.strictEqual(readFragmentToken(`#token=${encoded}`), 'abc-123_XYZ~');
});

test('readFragmentToken: a malformed percent-escape returns null, does not throw', () => {
  assert.doesNotThrow(() => readFragmentToken('#token=abc%'));
  assert.strictEqual(readFragmentToken('#token=abc%'), null);
  assert.strictEqual(readFragmentToken('#token=%zz'), null);
});

test('readFragmentToken: junk fragments with no "=" return null', () => {
  assert.strictEqual(readFragmentToken('#justjunk'), null);
});

test('readFragmentToken: only the first "&"-delimited segment is considered', () => {
  assert.strictEqual(readFragmentToken('#token=abc123&extra=y'), 'abc123');
  assert.strictEqual(readFragmentToken('#other=x&token=abc123'), null);
});

test('stripFragment: removes only the fragment, preserving path and query', () => {
  assert.strictEqual(
    stripFragment('https://example.com/app?x=1#token=abc123'),
    'https://example.com/app?x=1',
  );
});

test('stripFragment: an href with no fragment is returned unchanged', () => {
  assert.strictEqual(
    stripFragment('https://example.com/app?x=1'),
    'https://example.com/app?x=1',
  );
});
