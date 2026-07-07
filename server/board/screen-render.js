'use strict';
// The byte-stream -> rendered-screen transform, and the single place the VT
// emulator (@xterm/headless) is used. It knows nothing about the board, pipes,
// lines, or any specific TUI: feed it PTY bytes, read back the current grid.
//
// Two correctness invariants live here:
//  - Flush before read. @xterm/headless parses writes asynchronously (on a later
//    tick). snapshot() issues an empty write whose completion callback fires only
//    after every previously queued write has drained, so the buffer is fully
//    parsed before it is serialized — never read mid-parse.
//  - Untorn under active feed. Node's single event loop plus xterm applying each
//    write atomically between ticks means a snapshot taken while writes are still
//    arriving reflects a consistent grid at some write boundary. This module must
//    not defeat that (no partial reads, no reading before the flush resolves).
const { Terminal } = require('@xterm/headless');

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

// createScreen(cols, rows) -> { write, resize, snapshot, dispose }
function createScreen(cols, rows) {
  const term = new Terminal({
    cols: cols > 0 ? cols : DEFAULT_COLS,
    rows: rows > 0 ? rows : DEFAULT_ROWS,
    // Only the live grid matters — no scrollback accumulation, so a snapshot's
    // size is bounded by the dimensions regardless of how much has been fed.
    scrollback: 0,
    allowProposedApi: true,
  });

  // Feed a chunk of PTY output. Accepts a string or a Buffer/Uint8Array (a Node
  // Buffer is a Uint8Array, which xterm consumes directly). Returns a promise
  // that resolves once the chunk has been parsed, for callers that need it.
  function write(bytes) {
    return new Promise((resolve) => term.write(bytes, resolve));
  }

  // Change the grid dimensions; subsequent output lays out to the new width.
  function resize(nextCols, nextRows) {
    term.resize(nextCols > 0 ? nextCols : term.cols, nextRows > 0 ? nextRows : term.rows);
  }

  // Return the rendered screen: the active buffer's visible rows joined by \n,
  // each right-trimmed and trailing all-blank rows dropped, plus the cursor
  // (untrimmed coords) and current dimensions.
  async function snapshot() {
    await new Promise((resolve) => term.write('', resolve));
    const buf = term.buffer.active;
    const base = buf.baseY;
    const out = [];
    for (let y = 0; y < term.rows; y++) {
      const line = buf.getLine(base + y);
      // Render the full row (null cells materialize as spaces) then right-trim
      // trailing whitespace ourselves: xterm's own trimRight only drops null
      // cells, not explicitly-written trailing spaces. Leading and interior
      // spacing that positions content is kept.
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

  // Release the emulator and its resources.
  function dispose() {
    term.dispose();
  }

  return { write, resize, snapshot, dispose };
}

module.exports = { createScreen };
