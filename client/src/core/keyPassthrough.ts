// The guard behind TerminalView's attachCustomKeyEventHandler wiring, pulled
// out of the .tsx mount effect so it's directly unit-testable (no
// component-rendering harness exists — see CLAUDE.md). Returning false skips
// xterm's own keydown handling entirely (nothing written to the PTY) without
// touching preventDefault/stopPropagation, so the native event still bubbles
// to a document-level listener. Absent passthroughKeys this is always true —
// today's behavior, unchanged.
export function shouldXtermConsumeKey(
  passthroughKeys: ((e: KeyboardEvent) => boolean) | undefined,
  e: KeyboardEvent,
): boolean {
  return !(passthroughKeys?.(e) ?? false);
}
