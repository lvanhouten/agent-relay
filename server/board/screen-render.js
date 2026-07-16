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
const { SerializeAddon } = require('@xterm/addon-serialize');

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

// A generous but bounded scrollback for the attach-replay emulator. The board's
// raw byte-log is itself capped (SCROLLBACK chunks), so reconstructing it here
// bounds the *replayed* history to this many lines — more than any joiner scrolls
// through, and finite so a repaint-heavy line can't balloon the transient
// emulator. A very long session shows slightly less history here than the full
// raw byte-log would.
const REPLAY_SCROLLBACK = 5000;

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

// Reconstruct a coherent, width-correct replay of a line's scrollback for a
// freshly attaching client, returned as an escape-sequence string to write to
// that client's terminal.
//
// Why not just replay the raw byte-log: it was captured at the PTY's width(s) at
// the time, and a normal-buffer TUI (Claude Code, a shell with a redrawing
// prompt) fills that log with cursor-RELATIVE redraws ("cursor up N, clear,
// redraw"). Those N-line moves assume the capture-time wrap layout; replayed into
// a terminal of a different width they land on the wrong rows, leaving characters
// from an earlier redraw un-overwritten — the garble that only a resize (which
// forces the live app to repaint) clears. Feeding the log through a VT emulator
// sized to the CURRENT width and serializing its buffer collapses every redraw
// into flat content + attributes, so the replay carries no width-relative cursor
// moves; the target terminal re-wraps clean text at its own width. Colors and the
// final cursor position are preserved by the serializer. The emulator is
// transient — disposed before return.
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
    // Flush before read: the empty write's callback fires only after every queued
    // write has parsed (the same @xterm/headless invariant snapshot() relies on),
    // so the buffer is whole before the serializer walks it.
    await new Promise((resolve) => term.write('', resolve));
    // excludeModes: the replay restores the joiner's visible screen, not the PTY's
    // input-handling modes. Serializing modes re-asserts the source's DEC private
    // modes (mouse tracking ?1003h, bracketed paste, application cursor keys, focus
    // reporting) as trailing sequences on every attach. Mouse tracking in the web
    // client hands wheel + drag to the PTY, so local scrollback scroll and text
    // selection go dead until a resize. The live stream re-establishes whatever
    // modes the running app still wants; the replay must not force stale ones.
    return serialize.serialize({ excludeModes: true });
  } finally {
    term.dispose();
  }
}

module.exports = { createScreen, reconstructReplay };
