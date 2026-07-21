'use strict';
// Pure screen-render serializer tests - no board, no PTY, no pipes.
const test = require('node:test');
const assert = require('node:assert');
const { createScreen, reconstructReplay } = require('./screen-render');

const ESC = '\x1b';
const clear = ESC + '[2J' + ESC + '[H';
const move = (r, c) => ESC + '[' + r + ';' + c + 'H';
const alt = ESC + '[?1049h';
const bold = ESC + '[1m';
const reset = ESC + '[0m';

const hasAnsi = (s) => /\x1b|\x9b/.test(s);

// Spike checks kept as permanent assertions - the feature's placement (ADR-0002)
// depends on these holding in this process.

test('SPIKE 1: @xterm/headless loads under CommonJS require', () => {
  // Reaching here proves the CJS require succeeded - no ESM-only/DOM-only blocker.
  const s = createScreen(80, 24);
  assert.strictEqual(typeof s.snapshot, 'function');
  s.dispose();
});

test('SPIKE 2: an alt-screen dialog frame renders the caret intact on the active buffer', async () => {
  const s = createScreen(80, 24);
  await s.write(
    alt + clear +
    move(1, 1) + 'Do you want to proceed?' +
    move(2, 1) + bold + '❯ 1. Yes' + reset +
    move(3, 1) + '  2. No, and tell Claude what to do differently'
  );
  const snap = await s.snapshot();
  const rows = snap.grid.split('\n');
  assert.strictEqual(rows[1], '❯ 1. Yes', 'caret line renders verbatim');
  assert.ok(!hasAnsi(snap.grid), 'no escapes leaked into the grid');
  s.dispose();
});

// Permanent guard, not a spike: flush-before-read relies on term.write('', cb) firing
// only after prior writes drain - an undocumented @xterm/headless behavior (pinned
// ^6.0.0). A version bump that breaks it would silently produce torn snapshots.
test('SPIKE 3: a snapshot taken under active feed is never torn', async () => {
  const s = createScreen(80, 24);
  let torn = false;
  for (let i = 0; i < 200; i++) {
    const spinner = ['|', '/', '-', '\\'][i % 4];
    // Fire without awaiting — repaint churn arriving between ticks.
    s.write(clear + move(1, 1) + 'working ' + spinner + move(2, 1) + 'n=' + i);
    if (i % 7 === 0) {
      const snap = await s.snapshot();
      const first = snap.grid.split('\n')[0] || '';
      if (!/^working [|/\\-]$/.test(first)) torn = true;
    }
  }
  assert.strictEqual(torn, false, 'every snapshot is a whole frame, never half-applied');
  s.dispose();
});

test('no ANSI escapes survive into the grid from an escape+text sequence', async () => {
  const s = createScreen(40, 10);
  await s.write(ESC + '[31m' + 'red' + ESC + '[0m' + ESC + '[1mbold' + reset + '\r\nplain');
  const snap = await s.snapshot();
  assert.ok(!hasAnsi(snap.grid));
  assert.strictEqual(snap.grid, 'redbold\nplain');
  s.dispose();
});

test('a ❯ selection caret renders in the expected cell of the grid', async () => {
  const s = createScreen(40, 10);
  // Place the caret at row 4 (1-based), column 3 (1-based) => grid[3], col index 2.
  await s.write(clear + move(4, 3) + '❯ pick me');
  const snap = await s.snapshot();
  const row = snap.grid.split('\n')[3];
  assert.strictEqual(row, '  ❯ pick me', 'leading spaces position the caret');
  assert.strictEqual(row.indexOf('❯'), 2, 'caret sits in the expected column');
  s.dispose();
});

test('rows are right-trimmed and leading/interior spacing is preserved', async () => {
  const s = createScreen(40, 10);
  // Leading spaces + interior gap + trailing spaces on one row.
  await s.write(clear + move(1, 1) + '  a    b' + '        ');
  const snap = await s.snapshot();
  assert.strictEqual(snap.grid.split('\n')[0], '  a    b', 'trailing trimmed, leading + interior kept');
  s.dispose();
});

test('trailing all-blank rows are dropped entirely', async () => {
  const s = createScreen(40, 10);
  await s.write(clear + move(1, 1) + 'first' + move(2, 1) + 'second');
  const snap = await s.snapshot();
  // Only the two non-blank rows remain; rows 3..10 (blank) are gone.
  assert.strictEqual(snap.grid, 'first\nsecond');
  s.dispose();
});

test('interior all-blank rows between content are preserved', async () => {
  const s = createScreen(40, 10);
  await s.write(clear + move(1, 1) + 'top' + move(3, 1) + 'bottom');
  const snap = await s.snapshot();
  assert.strictEqual(snap.grid, 'top\n\nbottom', 'the blank middle row survives');
  s.dispose();
});

test('snapshot reports cursor row/col in untrimmed coords and current dims', async () => {
  const s = createScreen(80, 24);
  await s.write(clear + move(5, 10) + 'X'); // cursor lands just after X, at col 10 (0-based)
  const snap = await s.snapshot();
  assert.strictEqual(snap.cols, 80);
  assert.strictEqual(snap.rows, 24);
  assert.strictEqual(snap.cursor.row, 4, 'row 5 (1-based) => 4 (0-based)');
  assert.strictEqual(snap.cursor.col, 10, 'cursor advanced past X written at col 9');
  s.dispose();
});

test('cursor row is in the untrimmed space even when trailing blank rows are dropped', async () => {
  const s = createScreen(80, 24);
  // Put content high up but park the cursor on a low, otherwise-blank row.
  await s.write(clear + move(1, 1) + 'header' + move(20, 5) + ESC + '[0m');
  const snap = await s.snapshot();
  // Trimmed grid has just the header row, but the cursor keeps its real row.
  assert.strictEqual(snap.grid, 'header');
  assert.strictEqual(snap.cursor.row, 19, 'row 20 (1-based) => 19, untrimmed');
  assert.strictEqual(snap.cursor.col, 4);
  s.dispose();
});

test('after resize, snapshot reflects new dims and lays content to the new width', async () => {
  const s = createScreen(20, 10);
  s.resize(60, 8);
  let snap = await s.snapshot();
  assert.strictEqual(snap.cols, 60);
  assert.strictEqual(snap.rows, 8);
  // A 40-char line fits on one row at width 60 (would have wrapped at 20).
  const line = '0123456789012345678901234567890123456789';
  await s.write(clear + move(1, 1) + line);
  snap = await s.snapshot();
  assert.strictEqual(snap.grid, line, 'content laid out to the new width, not sheared');
  s.dispose();
});

test('snapshot size stays bounded by the dimensions regardless of output volume', async () => {
  const s = createScreen(40, 10);
  // Feed far more lines than the grid can hold; scrollback:0 means none accumulate.
  let feed = '';
  for (let i = 0; i < 5000; i++) feed += 'line ' + i + '\r\n';
  await s.write(feed);
  const snap = await s.snapshot();
  const gridRows = snap.grid.split('\n');
  assert.ok(gridRows.length <= snap.rows, 'row count bounded by grid height');
  assert.ok(snap.grid.length <= snap.rows * (snap.cols + 1), 'total size bounded by dims');
  s.dispose();
});

test('dispose releases the emulator without throwing', () => {
  const s = createScreen(40, 10);
  assert.doesNotThrow(() => s.dispose());
});

// Raw redraws are width-coherent only at capture width; reconstructReplay serializes
// flat lines at capture width so a differently-wide joiner re-wraps clean, not
// garbled (the `sb join` scroll-garble).

async function renderRows(bytes, cols, rows = 24) {
  const s = createScreen(cols, rows);
  await s.write(bytes);
  const snap = await s.snapshot();
  s.dispose();
  return snap.grid.split('\n');
}

test('reconstructReplay round-trips: replay rendered at the reconstruction width matches a direct render', async () => {
  const bytes = ESC + '[31mred' + reset + '\r\nsecond line\r\nthird';
  const replay = await reconstructReplay([bytes], 40, 24);
  const direct = await renderRows(bytes, 40);
  const viaReplay = await renderRows(replay, 40);
  assert.deepStrictEqual(viaReplay, direct, 'the serialized replay reproduces the same grid');
});

test('reconstructReplay resolves a width-fragile cursor-relative redraw so a narrower joiner renders it clean', async () => {
  const CAPTURE = 40, JOIN = 20;
  const long = 'ABCDEFGHIJKLMNOPQRSTUVWXY'; // 25 chars: one row at 40, wraps at 20
  // At the capture width, "up 2 lines, overwrite" lands on SHORT as intended.
  const log = clear + 'SHORT\r\n' + long + '\r\n' + ESC + '[2A' + '\rOVER';

  // Raw replay into a narrower joiner: the long line wraps, so up-2 lands on its
  // wrapped row instead of SHORT - the redraw misses and corrupts the long line (the bug).
  const rawAtJoin = await renderRows(log, JOIN);
  assert.ok(rawAtJoin.includes('SHORT'), 'raw replay: the redraw missed SHORT');
  assert.ok(!rawAtJoin.some(r => r.startsWith('ABCDEFGHIJKLMNOPQRST')),
    'raw replay: the long line is corrupted');

  // Reconstructed at capture width, then rendered at join width: redraw correctly
  // hits SHORT -> OVERT, long line stays intact.
  const replay = await reconstructReplay([log], CAPTURE, 24);
  const viaReplay = await renderRows(replay, JOIN);
  assert.ok(viaReplay.includes('OVERT'), 'reconstruction applied the redraw to SHORT');
  assert.ok(!viaReplay.includes('SHORT'), 'SHORT was overwritten as intended');
  assert.ok(viaReplay.some(r => r.startsWith('ABCDEFGHIJKLMNOPQRST')),
    'the long line survives intact, re-wrapped at the join width');
});

test('reconstructReplay preserves scrollback history beyond the visible grid', async () => {
  // More lines than the grid holds; they must land in scrollback - the whole point
  // of inline history on join.
  let feed = '';
  for (let i = 0; i < 60; i++) feed += 'line ' + i + '\r\n';
  const replay = await reconstructReplay([feed], 80, 24);
  assert.ok(replay.includes('line 0'), 'the oldest line is retained in the replay');
  assert.ok(replay.includes('line 59'), 'the newest line is retained in the replay');
});

test('reconstructReplay handles an empty log', async () => {
  assert.strictEqual(await reconstructReplay([], 80, 24), '', 'nothing captured -> empty replay');
});

// Replay restores content only, not modes: SerializeAddon re-asserts DEC private modes
// unless excludeModes is set, and mouse tracking (?1003h) would hijack the client's
// scroll/selection until a resize. The live stream re-asserts modes the app still
// wants, so replay must not.
test('reconstructReplay does not re-assert interactive input modes into the joiner', async () => {
  // Source enables mouse tracking + SGR encoding + bracketed paste, then keeps
  // emitting (modes stay on in the emulator's final state).
  const log =
    'header line\r\n' +
    ESC + '[?1003h' + ESC + '[?1006h' + ESC + '[?2004h' +
    ESC + '[?1h' + // application cursor keys
    'body line one\r\nbody line two\r\n';
  const replay = await reconstructReplay([log], 80, 24);

  const modeSeqs = replay.match(/\x1b\[\?[0-9;]+[hl]/g) || [];
  assert.deepStrictEqual(modeSeqs, [], 'no DEC private mode re-assertions leak into the replay');
  assert.ok(!replay.includes(ESC + '[?1003h'), 'mouse tracking is not re-enabled on attach');
  assert.ok(!replay.includes(ESC + '[?2004h'), 'bracketed paste is not re-enabled on attach');

  // Content is still restored faithfully - only the modes are dropped.
  const rows = await renderRows(replay, 80);
  assert.ok(rows.includes('header line'), 'visible content survives the mode exclusion');
  assert.ok(rows.includes('body line two'), 'later content survives too');
});
