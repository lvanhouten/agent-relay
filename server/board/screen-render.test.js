'use strict';
// Serializer behaviors for the pure screen-render module. Runs in isolation — no
// board, no PTY, no pipes. Prior art: board.test.js / lib.test.js pure helpers.
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

// --- Spike checks, recorded as permanent assertions ------------------------
// The feature's placement (ADR 0002) depends on these holding in this process.

test('SPIKE 1: @xterm/headless loads under CommonJS require', () => {
  // The module under test require()s it at load; reaching here proves the CJS
  // load succeeded with no ESM-only / DOM-only blocker.
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

// SPIKE 3 is a PERMANENT regression guard, not a throwaway spike: snapshot()'s
// flush-before-read correctness rides on term.write('', cb) firing its callback
// only after all previously-queued writes have drained (screen-render.js:46-47).
// That is an internal @xterm/headless write-buffer behavior, not a documented API
// contract, and the dep is pinned `^6.0.0` (server/package.json) — a minor/patch
// bump that short-circuits empty writes (calling the callback before prior writes
// parse) would silently produce torn/stale snapshots. This test is the tripwire
// that would catch such an upgrade break, so it must never be removed as "just a
// spike."
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

// --- Serializer behavior ----------------------------------------------------

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

// --- reconstructReplay (attach-time history reconstruction) ------------------
// The fix for the `sb join` scroll-garble: the raw byte-log's cursor-relative
// redraws are only coherent at the width they were emitted at, so replaying the
// log verbatim into a joiner of a different width garbles. reconstructReplay
// resolves the log through an emulator at the CAPTURE width and serializes flat
// logical lines, which the joiner then re-wraps clean at its own width.

// Render a byte string into a fresh grid of the given size; return its rows.
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

  // Raw replay into the narrow joiner: the long line now wraps, so up-2 lands on
  // its first wrapped row instead of SHORT — the redraw misses (SHORT survives)
  // and corrupts the long line. This is the bug.
  const rawAtJoin = await renderRows(log, JOIN);
  assert.ok(rawAtJoin.includes('SHORT'), 'raw replay: the redraw missed SHORT');
  assert.ok(!rawAtJoin.some(r => r.startsWith('ABCDEFGHIJKLMNOPQRST')),
    'raw replay: the long line is corrupted');

  // Reconstruct at the capture width, then render the flat replay at the join
  // width: the redraw resolved correctly (hit SHORT -> OVERT), long line intact.
  const replay = await reconstructReplay([log], CAPTURE, 24);
  const viaReplay = await renderRows(replay, JOIN);
  assert.ok(viaReplay.includes('OVERT'), 'reconstruction applied the redraw to SHORT');
  assert.ok(!viaReplay.includes('SHORT'), 'SHORT was overwritten as intended');
  assert.ok(viaReplay.some(r => r.startsWith('ABCDEFGHIJKLMNOPQRST')),
    'the long line survives intact, re-wrapped at the join width');
});

test('reconstructReplay preserves scrollback history beyond the visible grid', async () => {
  // More lines than the grid is tall: they must land in the serialized replay's
  // scrollback (the whole point of keeping inline history on join).
  let feed = '';
  for (let i = 0; i < 60; i++) feed += 'line ' + i + '\r\n';
  const replay = await reconstructReplay([feed], 80, 24);
  assert.ok(replay.includes('line 0'), 'the oldest line is retained in the replay');
  assert.ok(replay.includes('line 59'), 'the newest line is retained in the replay');
});

test('reconstructReplay handles an empty log', async () => {
  assert.strictEqual(await reconstructReplay([], 80, 24), '', 'nothing captured -> empty replay');
});

// The replay restores the visible screen, NOT the PTY's input-handling modes.
// SerializeAddon.serialize() re-asserts the source emulator's DEC private modes
// unless excludeModes is set. Mouse tracking (?1003h) in particular hands the web
// client's wheel + drag to the PTY, so scrollback scroll and text selection die on
// attach until a resize (the regression a joiner into a Claude Code line hit). The
// live stream re-establishes any modes the running app still wants — the replay
// must not force them.
test('reconstructReplay does not re-assert interactive input modes into the joiner', async () => {
  // Source turns on mouse tracking + SGR encoding + bracketed paste, then keeps
  // emitting content (modes stay on in the emulator's final state).
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

  // Content is still faithfully restored — only the modes are dropped.
  const rows = await renderRows(replay, 80);
  assert.ok(rows.includes('header line'), 'visible content survives the mode exclusion');
  assert.ok(rows.includes('body line two'), 'later content survives too');
});
