// The guard behind TerminalView's attachCustomKeyEventHandler wiring. Returning
// false skips xterm's own keydown handling (nothing written to the PTY)
// without touching preventDefault/stopPropagation, so the native event still
// bubbles to a document-level listener. Absent passthroughKeys this is always true.
export function shouldXtermConsumeKey(
  passthroughKeys: ((e: KeyboardEvent) => boolean) | undefined,
  e: KeyboardEvent,
): boolean {
  return !(passthroughKeys?.(e) ?? false);
}
