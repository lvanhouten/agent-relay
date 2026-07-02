// claudeFlags — the pure half of the model/effort chips. The dialog is
// harness-exempt per repo convention; these functions carry the behavior.
import test from 'node:test';
import assert from 'node:assert';
import { isClaudeCommand, getFlag, setFlag } from './claudeFlags.ts';

test('isClaudeCommand: bare and flagged claude invocations match', () => {
  assert.strictEqual(isClaudeCommand('claude'), true);
  assert.strictEqual(isClaudeCommand('  claude --model opus'), true);
});

test('isClaudeCommand: Windows-qualified and cased invocations match (N4)', () => {
  assert.strictEqual(isClaudeCommand('claude.cmd --model opus'), true);
  assert.strictEqual(isClaudeCommand('claude.exe'), true);
  assert.strictEqual(isClaudeCommand('CLAUDE --effort high'), true);
});

test('isClaudeCommand: other commands and prefixes do not', () => {
  assert.strictEqual(isClaudeCommand('bash'), false);
  assert.strictEqual(isClaudeCommand('claudette'), false);
  assert.strictEqual(isClaudeCommand('claudette.exe'), false);
  assert.strictEqual(isClaudeCommand('npx claude'), false);
  assert.strictEqual(isClaudeCommand(''), false);
});

test('getFlag: absent flag is null', () => {
  assert.strictEqual(getFlag('claude', 'model'), null);
});

test('getFlag: space and = separators both read', () => {
  assert.strictEqual(getFlag('claude --model opus', 'model'), 'opus');
  assert.strictEqual(getFlag('claude --model=opus', 'model'), 'opus');
});

test('getFlag: quoted values come back unquoted', () => {
  assert.strictEqual(getFlag('claude --model "claude-sonnet-5"', 'model'), 'claude-sonnet-5');
});

test('getFlag: name boundary — --models does not read as --model', () => {
  assert.strictEqual(getFlag('claude --models opus', 'model'), null);
});

test('setFlag: appends when absent', () => {
  assert.strictEqual(setFlag('claude', 'model', 'opus'), 'claude --model opus');
});

test('setFlag: replaces in place when present, other text untouched', () => {
  assert.strictEqual(
    setFlag('claude --model sonnet --effort high "do the thing"', 'model', 'opus'),
    'claude --model opus --effort high "do the thing"',
  );
});

test('setFlag: = form is normalized to space form on replace', () => {
  assert.strictEqual(setFlag('claude --model=sonnet', 'model', 'opus'), 'claude --model opus');
});

test('setFlag: null removes the flag and its value cleanly', () => {
  assert.strictEqual(setFlag('claude --model opus --effort high', 'model', null), 'claude --effort high');
  assert.strictEqual(setFlag('claude --model opus', 'model', null), 'claude');
});

test('setFlag: removal leaves quoted args with internal spacing intact', () => {
  assert.strictEqual(
    setFlag('claude --model opus "two  spaces  stay"', 'model', null),
    'claude "two  spaces  stay"',
  );
});

test('setFlag: removing an absent flag is a no-op', () => {
  assert.strictEqual(setFlag('claude --effort high', 'model', null), 'claude --effort high');
});

// W1 of the branch review: both write paths must treat the value as literal
// text, and a value getFlag read out of quotes must write back into them.
test('setFlag: a $ in the value is literal, not a replace-pattern (W1)', () => {
  // Before the fix, $& re-inserted the matched flag: 'claude --model a --model xb'.
  assert.strictEqual(setFlag('claude --model x', 'model', 'a$&b'), 'claude --model a$&b');
  assert.strictEqual(setFlag('claude', 'model', 'a$&b'), 'claude --model a$&b');
});

test('setFlag: a value with whitespace is re-quoted on write (W1)', () => {
  assert.strictEqual(setFlag('claude', 'model', 'a b'), 'claude --model "a b"');
  assert.strictEqual(setFlag('claude --model x', 'model', 'a b'), 'claude --model "a b"');
});

test('read→write round trip preserves a quoted value (W1)', () => {
  const read = getFlag('claude --model "a b"', 'model');
  assert.strictEqual(read, 'a b');
  const written = setFlag('claude', 'model', read);
  assert.strictEqual(getFlag(written, 'model'), 'a b');
});

test('round trip: chips toggling both flags compose', () => {
  let cmd = 'claude';
  cmd = setFlag(cmd, 'model', 'haiku');
  cmd = setFlag(cmd, 'effort', 'low');
  assert.strictEqual(cmd, 'claude --model haiku --effort low');
  cmd = setFlag(cmd, 'model', null);
  assert.strictEqual(cmd, 'claude --effort low');
  assert.strictEqual(getFlag(cmd, 'effort'), 'low');
});
