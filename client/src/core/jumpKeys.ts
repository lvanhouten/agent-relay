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

// Whether the currently-focused element should SWALLOW a jump chord instead of
// letting it switch sessions. The workspace listens for Alt+digit on the whole
// document (so the chord works even while the terminal is focused), which means
// it would otherwise also fire while the operator is typing in the sidebar
// filter, a dialog field, or the find bar — eating the keystroke and swapping
// the selection behind whatever's on top. xterm's own hidden textarea (inside a
// `.xterm` container) is the deliberate exception: the chord is designed to fire
// there, since TerminalView's passthrough leaves the keydown uneaten.
export interface FocusProbe {
  tagName: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

export function isTypingTarget(el: FocusProbe | null): boolean {
  if (!el) return false;
  if (el.closest?.('.xterm')) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}
