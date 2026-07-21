// The scroll-to-bottom pill's state math: "am I detached from the tail, and
// how many lines have I missed" as a pure reducer, kept out of the xterm
// event handlers so the counting rules are unit-tested directly.

export interface PillState {
  // true when the viewport is pinned to the newest output (no pill shown).
  atBottom: boolean;
  // lines that have scrolled off the bottom while detached — the "↓ N new" count.
  newLines: number;
}

export const PILL_INIT: PillState = { atBottom: true, newLines: 0 };

// xterm exposes viewportY (top row currently shown) and baseY (top row of the
// last screen). They are equal exactly when scrolled to the tail.
export function isAtBottom(viewportY: number, baseY: number): boolean {
  return viewportY >= baseY;
}

// A scroll happened — recompute pinned-ness. Re-reaching the bottom clears the
// missed-line count; scrolling up preserves whatever has accumulated.
export function onScroll(state: PillState, viewportY: number, baseY: number): PillState {
  if (isAtBottom(viewportY, baseY)) return PILL_INIT;
  if (state.atBottom) return { atBottom: false, newLines: 0 };
  return state;
}

// A line fed into the buffer. Only counts while detached — output arriving with
// the viewport already at the tail simply scrolls into view and needs no pill.
export function onLine(state: PillState): PillState {
  if (state.atBottom) return state;
  return { atBottom: false, newLines: state.newLines + 1 };
}
