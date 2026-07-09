// The one definition of "a session-jump chord": Alt + a bare digit 1-9, and
// nothing else. Shared by TerminalView's passthrough (so it knows which
// keydowns to let escape uneaten) and the workspace shell's document-level
// listener (brief 05) — both call this, so they can never disagree about
// what counts as a jump chord.

// Recognized via event.code (the physical key, e.g. 'Digit3') rather than
// event.key: Alt is a common layout/dead-key modifier, and on layouts where
// Alt remaps event.key (e.g. AltGr-adjacent European layouts) the physical
// digit row still reports Digit1..Digit9 regardless of what character it
// would otherwise produce.
const DIGIT_CODE = /^Digit([1-9])$/;

export function jumpIndexFromKey(
  e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key' | 'repeat'>,
): number | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return null;
  const match = DIGIT_CODE.exec(e.code);
  if (!match) return null;
  return Number(match[1]);
}
