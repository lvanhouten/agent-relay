import test from 'node:test';
import assert from 'node:assert';
import {
  parseTemplates, serializeTemplates, upsertTemplate, removeTemplate, fallbackLabel,
} from './templates.ts';
import type { SpawnTemplate } from './templates.ts';

const tpl = (label: string, over: Partial<SpawnTemplate> = {}): SpawnTemplate => ({
  label, name: label, cwd: '~/', command: 'claude', ...over,
});

test('parseTemplates: null / empty string yields an empty list', () => {
  assert.deepStrictEqual(parseTemplates(null), []);
  assert.deepStrictEqual(parseTemplates(''), []);
});

test('parseTemplates: unparseable JSON is swallowed, not thrown', () => {
  assert.deepStrictEqual(parseTemplates('{not json'), []);
});

test('parseTemplates: a non-array (object, number) yields empty', () => {
  assert.deepStrictEqual(parseTemplates('{"label":"x"}'), []);
  assert.deepStrictEqual(parseTemplates('42'), []);
});

test('parseTemplates: malformed entries are dropped, well-formed kept', () => {
  const raw = JSON.stringify([
    tpl('good'),
    { label: 'no-command', name: 'x', cwd: '~/' },   // missing command
    { label: '', name: 'x', cwd: '~/', command: '' }, // blank label
    { label: 'bad-types', name: 1, cwd: '~/', command: '' },
  ]);
  assert.deepStrictEqual(parseTemplates(raw).map((t) => t.label), ['good']);
});

test('parseTemplates: a plain-shell template (empty command) is valid', () => {
  const raw = serializeTemplates([tpl('pwsh', { command: '' })]);
  assert.strictEqual(parseTemplates(raw).length, 1);
});

test('upsertTemplate: a new label appends', () => {
  const list = [tpl('a')];
  const next = upsertTemplate(list, tpl('b'));
  assert.deepStrictEqual(next.map((t) => t.label), ['a', 'b']);
});

test('upsertTemplate: an existing label replaces in place, order preserved', () => {
  const list = [tpl('a'), tpl('b'), tpl('c')];
  const next = upsertTemplate(list, tpl('b', { cwd: '~/changed' }));
  assert.deepStrictEqual(next.map((t) => t.label), ['a', 'b', 'c']);
  assert.strictEqual(next[1].cwd, '~/changed');
});

test('upsertTemplate: label is trimmed before compare and store', () => {
  const list = [tpl('a')];
  const next = upsertTemplate(list, tpl('  a  ', { cwd: '~/edited' }));
  assert.strictEqual(next.length, 1);
  assert.strictEqual(next[0].label, 'a');
  assert.strictEqual(next[0].cwd, '~/edited');
});

test('removeTemplate: drops the matching label only', () => {
  const list = [tpl('a'), tpl('b')];
  assert.deepStrictEqual(removeTemplate(list, 'a').map((t) => t.label), ['b']);
});

test('serialize -> parse round-trips a valid list', () => {
  const list = [tpl('a'), tpl('b', { command: '' })];
  assert.deepStrictEqual(parseTemplates(serializeTemplates(list)), list);
});

test('fallbackLabel: derived from command word + cwd leaf, so blank-name saves differ by content', () => {
  assert.strictEqual(fallbackLabel('C:\\Users\\x\\dev\\agent-relay', 'claude --model opus'), 'claude · agent-relay');
  assert.strictEqual(fallbackLabel('/repo/sub/', 'npm run dev'), 'npm · sub');
  // Two blank-name saves of DIFFERENT templates must not collide on one label
  // (the old literal 'template' fallback silently overwrote the first).
  assert.notStrictEqual(
    fallbackLabel('/repo/api', 'claude'),
    fallbackLabel('/repo/web', 'npm run dev'),
  );
});

test('fallbackLabel: blank command and bare cwd degrade to shell · ~', () => {
  assert.strictEqual(fallbackLabel('~/', ''), 'shell · ~');
});
