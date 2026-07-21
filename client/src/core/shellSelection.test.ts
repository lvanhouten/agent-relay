import test from 'node:test';
import assert from 'node:assert';
import { decideShell, readShellOverride, writeShellOverride, type StorageLike } from './shellSelection.ts';

// In-memory + throwing StorageLike stubs, so storage-misbehaves paths don't need a real browser API.
function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); },
  };
}

function throwingStorage(): StorageLike {
  return {
    getItem: () => { throw new Error('boom'); },
    setItem: () => { throw new Error('boom'); },
    removeItem: () => { throw new Error('boom'); },
  };
}

test('decideShell: landscape-wide with no override -> desktop', () => {
  assert.strictEqual(decideShell({ width: 1200, height: 800, override: null }), 'desktop');
});

test('decideShell: portrait, any width (including wider-than-768 portrait) -> mobile', () => {
  assert.strictEqual(decideShell({ width: 400, height: 800, override: null }), 'mobile');
  // Wider than 768 but still taller than wide — portrait wins over the width check.
  assert.strictEqual(decideShell({ width: 1200, height: 2000, override: null }), 'mobile');
});

test('decideShell: landscape narrower than 768 -> mobile', () => {
  assert.strictEqual(decideShell({ width: 500, height: 400, override: null }), 'mobile');
});

test('decideShell: exactly 768 landscape -> desktop', () => {
  assert.strictEqual(decideShell({ width: 768, height: 600, override: null }), 'desktop');
});

test('decideShell: an explicit override beats the heuristic in both directions', () => {
  // Heuristic would say desktop; override forces mobile.
  assert.strictEqual(decideShell({ width: 1200, height: 800, override: 'mobile' }), 'mobile');
  // Heuristic would say mobile (portrait); override forces desktop.
  assert.strictEqual(decideShell({ width: 400, height: 800, override: 'desktop' }), 'desktop');
  // Heuristic would say mobile (narrow landscape); override forces desktop.
  assert.strictEqual(decideShell({ width: 500, height: 400, override: 'desktop' }), 'desktop');
  // Heuristic would say desktop (exactly 768 landscape); override forces mobile.
  assert.strictEqual(decideShell({ width: 768, height: 600, override: 'mobile' }), 'mobile');
});

test('readShellOverride: absent key returns null', () => {
  assert.strictEqual(readShellOverride(memoryStorage()), null);
});

test('readShellOverride: a junk value returns null, not a truthy misread', () => {
  assert.strictEqual(readShellOverride(memoryStorage({ 'ar-shell-override': 'tablet' })), null);
  assert.strictEqual(readShellOverride(memoryStorage({ 'ar-shell-override': '' })), null);
});

test('readShellOverride: a recognized value round-trips', () => {
  assert.strictEqual(readShellOverride(memoryStorage({ 'ar-shell-override': 'mobile' })), 'mobile');
  assert.strictEqual(readShellOverride(memoryStorage({ 'ar-shell-override': 'desktop' })), 'desktop');
});

test('readShellOverride: a throwing storage returns null, never propagates', () => {
  assert.strictEqual(readShellOverride(throwingStorage()), null);
});

test('writeShellOverride: writes a recognized kind, then null clears it', () => {
  const storage = memoryStorage();
  writeShellOverride(storage, 'mobile');
  assert.strictEqual(readShellOverride(storage), 'mobile');
  writeShellOverride(storage, null);
  assert.strictEqual(readShellOverride(storage), null);
  // Also checks the raw key — a stringified "null" would fool readShellOverride if removeItem were skipped.
  assert.strictEqual(storage.getItem('ar-shell-override'), null);
});

test('writeShellOverride: a throwing storage does not propagate', () => {
  assert.doesNotThrow(() => writeShellOverride(throwingStorage(), 'mobile'));
  assert.doesNotThrow(() => writeShellOverride(throwingStorage(), null));
});
