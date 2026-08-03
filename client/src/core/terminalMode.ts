// What a view is allowed to do to the line it is attached to. Two independent
// capabilities, deliberately not one scale:
//
//   input   — may type into the PTY.
//   sizing  — owns the PTY's dimensions: fits itself, sends resize, and so joins
//             the board's smallest-pane clamp.
//
// They are separate because a grid pane needs one without the other. Fusing them
// meant the focused pane clamped the shared line to a thumbnail's geometry, and
// because the board keeps the last applied size when a pane leaves the clamp,
// every line ever focused in the grid stayed stuck at that cell's shape.
// Sizing belongs to a view rendering the line at full size.
import type { TerminalViewMode } from './types.ts';

export interface ModeCaps {
  input: boolean;
  sizing: boolean;
}

const CAPS: Record<TerminalViewMode, ModeCaps> = {
  interactive: { input: true, sizing: true },
  follow: { input: true, sizing: false },
  spectator: { input: false, sizing: false },
};

// Unknown mode falls back to the most restrictive combination: a view that
// cannot be identified must not be able to type into or reshape a live line.
export function capsFor(mode: TerminalViewMode): ModeCaps {
  return CAPS[mode] ?? { input: false, sizing: false };
}

// A view that does not own sizing renders the line at its reported dims and
// CSS-scales to fit, so it needs the scaled-mount layout regardless of input.
export function isScaled(mode: TerminalViewMode): boolean {
  return !capsFor(mode).sizing;
}
