// Reclaiming local scrollback scroll when the running app has grabbed the mouse.
//
// xterm forwards the wheel to the PTY whenever the app enables mouse tracking
// (Claude Code, vim, less, tmux all do), so its viewport stops scrolling local
// scrollback. Separately, xterm 6 wires up no touch handling, so a one-finger
// drag never scrolls on a phone. We scroll the local scrollback ourselves in
// both cases — but only in the NORMAL buffer; the alt screen is a full-screen
// surface the app owns, so its forwarding stays intact there.
//
// Decision + line math live here as pure functions, unit-tested directly;
// TerminalView owns the xterm wiring and the fractional accumulator.

export interface ScrollEnv {
  bufferType: 'normal' | 'alternate';
  // term.modes.mouseTrackingMode - 'none' when the app has not grabbed the mouse.
  mouseTracking: string;
  // css px per row (>0), for converting a pixel delta to a line count.
  cellHeight: number;
  // visible rows, for converting a page delta to a line count.
  rows: number;
}

// Lines to scroll the local scrollback for a wheel event (negative = up into
// history), or null to defer to xterm. Only takes over when the app has
// grabbed the mouse and there's scrollback to move (normal buffer); otherwise
// xterm's viewport already scrolls and taking over would double-scroll.
export function wheelScrollLines(deltaY: number, deltaMode: number, env: ScrollEnv): number | null {
  if (env.bufferType !== 'normal') return null;   // alt screen: the app owns it
  if (env.mouseTracking === 'none') return null;  // xterm's viewport handles it
  if (deltaY === 0) return null;
  switch (deltaMode) {
    case 1: return deltaY;                          // DOM_DELTA_LINE
    case 2: return deltaY * env.rows;               // DOM_DELTA_PAGE
    default: return deltaY / (env.cellHeight || 1); // DOM_DELTA_PIXEL
  }
}

// Lines to scroll for a touch drag of `dragPx` vertical pixels since the last
// sample (positive = finger moved down). Dragging down reveals earlier output
// (scrolls up into history), so the sign inverts. Null outside the normal
// buffer. Unlike the wheel, touch is claimed regardless of mouse tracking —
// xterm 6 has no touch scroll of its own, so plain shells would be stuck too.
export function touchScrollLines(dragPx: number, env: ScrollEnv): number | null {
  if (env.bufferType !== 'normal') return null;
  return -dragPx / (env.cellHeight || 1);
}

// Fractional-line accumulator. scrollLines() takes whole lines, but pixel and
// touch deltas are fractional; carrying the remainder keeps fine trackpad and
// touch drags smooth instead of quantizing every event to zero. Returns the
// whole lines to scroll now and the remainder to carry into the next call.
export function takeWholeLines(carried: number, add: number): { whole: number; rest: number } {
  const total = carried + add;
  const whole = Math.trunc(total);
  return { whole, rest: total - whole };
}
