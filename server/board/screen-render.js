'use strict';
// The byte-stream -> rendered-screen transform, and the only place the VT
// emulator (@xterm/headless) is used. Knows nothing about the board, pipes,
// lines, or any specific TUI: feed it PTY bytes, read back the current grid.
//
// Two correctness invariants:
//  - Flush before read: @xterm/headless parses writes asynchronously, so
//    snapshot() issues an empty write whose callback fires only after every
//    queued write has drained - never read mid-parse.
//  - Untorn under active feed: the single event loop plus xterm's atomic
//    per-tick writes mean a snapshot taken mid-feed still reflects a
//    consistent grid at some write boundary - this module must not defeat
//    that with a partial or pre-flush read.
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

// Generous but bounded scrollback for the attach-replay emulator. The board's
// raw byte-log is itself capped (SCROLLBACK chunks), so this bounds replayed
// history to more lines than any joiner scrolls through, while keeping a
// repaint-heavy line from ballooning the transient emulator - a very long
// session shows slightly less history here than the full raw log would.
const REPLAY_SCROLLBACK = 5000;

// createScreen(cols, rows) -> { write, resize, snapshot, dispose }
function createScreen(cols, rows) {
  const term = new Terminal({
    cols: cols > 0 ? cols : DEFAULT_COLS,
    rows: rows > 0 ? rows : DEFAULT_ROWS,
    // Only the live grid matters - no scrollback accumulation, so a snapshot's
    // size is bounded by dimensions regardless of how much has been fed.
    scrollback: 0,
    allowProposedApi: true,
  });

  // Feeds a chunk of PTY output (string or Buffer/Uint8Array - a Node Buffer IS
  // a Uint8Array, which xterm consumes directly); resolves once parsed.
  function write(bytes) {
    return new Promise((resolve) => term.write(bytes, resolve));
  }

  // Change the grid dimensions; subsequent output lays out to the new width.
  function resize(nextCols, nextRows) {
    term.resize(nextCols > 0 ? nextCols : term.cols, nextRows > 0 ? nextRows : term.rows);
  }

  // Returns the rendered screen: visible rows joined by \n, each right-trimmed
  // and trailing blank rows dropped, plus the cursor (untrimmed) and dimensions.
  async function snapshot() {
    await new Promise((resolve) => term.write('', resolve));
    const buf = term.buffer.active;
    const base = buf.baseY;
    const out = [];
    for (let y = 0; y < term.rows; y++) {
      const line = buf.getLine(base + y);
      // Renders the full row (null cells become spaces) then right-trims
      // ourselves: xterm's own trimRight only drops null cells, not
      // explicitly-written trailing spaces. Leading/interior spacing that
      // positions content is kept.
      const text = line ? line.translateToString(false) : '';
      out.push(text.replace(/\s+$/, ''));
    }
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return {
      grid: out.join('\n'),
      cursor: { row: base + buf.cursorY, col: buf.cursorX },
      cols: term.cols,
      rows: term.rows,
    };
  }

  function dispose() {
    term.dispose();
  }

  return { write, resize, snapshot, dispose };
}

// Reconstructs a coherent, width-correct replay of a line's scrollback for a
// freshly attaching client, as an escape-sequence string to write to their
// terminal.
//
// The raw byte-log can't just be replayed: it was captured at the PTY's width
// at the time, and a normal-buffer TUI (Claude Code, a redrawing shell prompt)
// fills it with cursor-RELATIVE redraws ("up N, clear, redraw") that assume
// the capture-time wrap layout - replayed at a different width they land on
// the wrong rows, garbling until a resize forces the live app to repaint.
// Feeding the log through a VT emulator sized to the CURRENT width and
// serializing its buffer collapses every redraw into flat content +
// attributes, so the target terminal re-wraps clean text at its own width;
// colors and the final cursor position survive via the serializer. The
// emulator is transient, disposed before return.
async function reconstructReplay(chunks, cols, rows) {
  const term = new Terminal({
    cols: cols > 0 ? cols : DEFAULT_COLS,
    rows: rows > 0 ? rows : DEFAULT_ROWS,
    scrollback: REPLAY_SCROLLBACK,
    allowProposedApi: true,
  });
  const serialize = new SerializeAddon();
  term.loadAddon(serialize);
  try {
    for (const chunk of chunks) term.write(chunk);
    // Flush before read: the empty write's callback fires only after every
    // queued write has parsed (same invariant snapshot() relies on) - buffer
    // is whole before the serializer walks it.
    await new Promise((resolve) => term.write('', resolve));
    // excludeModes: the replay restores the joiner's visible screen, not the
    // PTY's input-handling modes. Serializing modes would re-assert the
    // source's DEC private modes (mouse tracking, bracketed paste, app cursor
    // keys, focus reporting) on every attach - mouse tracking in particular
    // hands wheel+drag to the PTY, killing local scroll/selection until a
    // resize. The live stream re-establishes whatever modes the app still
    // wants; the replay must not force stale ones.
    return serialize.serialize({ excludeModes: true });
  } finally {
    term.dispose();
  }
}

module.exports = { createScreen, reconstructReplay };
