'use strict';
// recipe.env carries what the launcher needs to find the caller's window - the
// board is a detached daemon with no terminal of its own.
const test = require('node:test');
const assert = require('node:assert');
const { detectSpawner } = require('./spawners');

test('wezterm: recipe is `wezterm cli spawn` into a new tab (no --new-window)', () => {
  const r = detectSpawner({ WEZTERM_PANE: '3', WEZTERM_UNIX_SOCKET: '/tmp/wz' });
  assert.strictEqual(r.kind, 'wezterm');
  assert.deepStrictEqual(r.args, ['cli', 'spawn', '--', '{cmd}']);
  assert.ok(!r.args.includes('--new-window'), 'must not force a new window');
});

test('wezterm: WEZTERM_PANE is forwarded so the tab lands in the caller\'s current window', () => {
  // Forwarding only WEZTERM_UNIX_SOCKET reaches the mux but can't resolve the current
  // pane -> opens a new window instead of a tab; both vars must ride along.
  const r = detectSpawner({ WEZTERM_PANE: '3', WEZTERM_UNIX_SOCKET: '/tmp/wz' });
  assert.strictEqual(r.env.WEZTERM_PANE, '3', 'WEZTERM_PANE must be in the recipe env');
  assert.strictEqual(r.env.WEZTERM_UNIX_SOCKET, '/tmp/wz');
});

test('wezterm: an unset WEZTERM_UNIX_SOCKET is omitted, not forwarded as undefined', () => {
  // pick() drops absent keys; a bare WEZTERM_PANE session still works.
  const r = detectSpawner({ WEZTERM_PANE: '3' });
  assert.strictEqual(r.env.WEZTERM_PANE, '3');
  assert.ok(!('WEZTERM_UNIX_SOCKET' in r.env), 'absent socket is not a key');
});

test('tmux: new-window in the caller\'s session, TMUX forwarded', () => {
  const r = detectSpawner({ TMUX: '/tmp/tmux-1000/default,123,0', TMUX_PANE: '%4' });
  assert.strictEqual(r.kind, 'tmux');
  assert.deepStrictEqual(r.args, ['new-window', '-t', '%4', '{cmd}']);
  assert.strictEqual(r.env.TMUX, '/tmp/tmux-1000/default,123,0');
});

test('detection precedence: WEZTERM_PANE wins over a co-present WT_SESSION', () => {
  const r = detectSpawner({ WEZTERM_PANE: '3', WT_SESSION: 'abc' });
  assert.strictEqual(r.kind, 'wezterm');
});

test('SWITCHBOARD_TERM override splits into file + args', () => {
  const r = detectSpawner({ SWITCHBOARD_TERM: 'alacritty -e {cmd}' });
  assert.strictEqual(r.kind, 'custom');
  assert.strictEqual(r.file, 'alacritty');
  assert.deepStrictEqual(r.args, ['-e', '{cmd}']);
});

test('no known terminal on non-win32 → null (caller warns to set SWITCHBOARD_TERM)', () => {
  const saved = process.platform;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  try {
    assert.strictEqual(detectSpawner({}), null);
  } finally {
    Object.defineProperty(process, 'platform', { value: saved });
  }
});
