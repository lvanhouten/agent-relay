import test from 'node:test';
import assert from 'node:assert';
import { enqueue, dismiss, dismissKey, MAX_VISIBLE } from './toastQueue.ts';
import type { Toast } from './toastQueue.ts';

function mk(id: string, over: Partial<Toast> = {}): Toast {
  return { id, severity: 'info', message: id, sticky: false, duration: 5000, ...over };
}

test('enqueue: appends a new toast', () => {
  const s = enqueue([], mk('a'));
  assert.deepStrictEqual(s.map((t) => t.id), ['a']);
});

test('enqueue: same key coalesces in place, keeping slot and id', () => {
  let s = enqueue([], mk('a', { key: 'relay', message: 'first' }));
  s = enqueue(s, mk('b'));
  s = enqueue(s, mk('c', { key: 'relay', message: 'second' }));
  assert.strictEqual(s.length, 2);
  const relay = s[0];
  assert.strictEqual(relay.id, 'a');          // kept the original id (no remount)
  assert.strictEqual(relay.message, 'second'); // content refreshed
  assert.strictEqual(s[1].id, 'b');            // slot order preserved
});

test('enqueue: no key never coalesces even with identical content', () => {
  let s = enqueue([], mk('a', { message: 'dup' }));
  s = enqueue(s, mk('b', { message: 'dup' }));
  assert.deepStrictEqual(s.map((t) => t.id), ['a', 'b']);
});

test('enqueue: caps visible count, dropping the oldest transient first', () => {
  let s: Toast[] = [];
  for (const id of ['a', 'b', 'c', 'd']) s = enqueue(s, mk(id));
  assert.strictEqual(s.length, MAX_VISIBLE);
  assert.deepStrictEqual(s.map((t) => t.id), ['b', 'c', 'd']); // 'a' evicted
});

test('enqueue: a sticky toast is never evicted by a transient burst', () => {
  let s = enqueue([], mk('sticky', { sticky: true, key: 'relay' }));
  for (const id of ['a', 'b', 'c', 'd']) s = enqueue(s, mk(id));
  assert.strictEqual(s.length, MAX_VISIBLE);
  assert.ok(s.some((t) => t.id === 'sticky'), 'sticky survives the cap');
  assert.deepStrictEqual(s.map((t) => t.id), ['sticky', 'c', 'd']);
});

test('dismiss: removes by id', () => {
  const s = dismiss([mk('a'), mk('b')], 'a');
  assert.deepStrictEqual(s.map((t) => t.id), ['b']);
});

test('dismiss: returns the same reference when nothing matched', () => {
  const list = [mk('a')];
  assert.strictEqual(dismiss(list, 'missing'), list);
});

test('dismissKey: removes by key', () => {
  const s = dismissKey([mk('a', { key: 'relay' }), mk('b')], 'relay');
  assert.deepStrictEqual(s.map((t) => t.id), ['b']);
});

test('dismissKey: returns the same reference when the key is absent', () => {
  const list = [mk('a')];
  assert.strictEqual(dismissKey(list, 'relay'), list);
});
