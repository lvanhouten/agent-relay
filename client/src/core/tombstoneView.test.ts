import test from 'node:test';
import assert from 'node:assert';
import { tombstoneView } from './tombstoneView.ts';
import type { Session } from './types.ts';

// A tombstone DTO (server/src/sessions.js endedToDto): status 'exited' with a
// `reason` and `exitCode`. These pin the crash predicate + status word so the
// three surfaces that render a tombstone (sidebar row, session card, detail
// pane) can't drift from each other.
const tomb = (reason: string, exitCode: number | null): Session => ({
  id: '1', name: 's-1', shell: 'bash', cwd: '~', pid: null,
  status: 'exited', lastActive: 'just now', reason, exitCode,
});

test('killed: offline dot, not a crash, labeled "killed"', () => {
  assert.deepStrictEqual(tombstoneView(tomb('killed', null)),
    { killed: true, failed: false, dot: 'offline', label: 'killed' });
});

test('a kill is never a crash even with a non-zero code', () => {
  // reason wins: the board reports the exit code of a killed process too, but a
  // deliberate terminate must not render as an error.
  assert.deepStrictEqual(tombstoneView(tomb('killed', 137)),
    { killed: true, failed: false, dot: 'offline', label: 'killed' });
});

test('clean exit (code 0): offline dot, not a crash, labeled "exit 0"', () => {
  assert.deepStrictEqual(tombstoneView(tomb('exited', 0)),
    { killed: false, failed: false, dot: 'offline', label: 'exit 0' });
});

test('non-zero exit: error dot, crash, labeled "exit N"', () => {
  assert.deepStrictEqual(tombstoneView(tomb('exited', 2)),
    { killed: false, failed: true, dot: 'error', label: 'exit 2' });
});

test('unknown (null) exit code is not presented as a crash', () => {
  assert.deepStrictEqual(tombstoneView(tomb('exited', null)),
    { killed: false, failed: false, dot: 'offline', label: 'exit ?' });
});
