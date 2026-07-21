// The one definition of "a session-jump chord": Alt + a bare digit 1-9.
// Shared by TerminalView's passthrough and the workspace's document-level
// listener so the two can never disagree on what counts as a jump chord.

// Uses event.code (physical key, e.g. 'Digit3') not event.key: on layouts
// where Alt remaps event.key (AltGr-adjacent European layouts), the physical
// digit row still reports Digit1..Digit9 regardless of the produced character.
const DIGIT_CODE = /^Digit([1-9])$/;

export function jumpIndexFromKey(
  e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key' | 'repeat'>,
): number | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return null;
  const match = DIGIT_CODE.exec(e.code);
  if (!match) return null;
  return Number(match[1]);
}

// Whether the focused element should SWALLOW a jump chord instead of switching
// sessions. The workspace listens for Alt+digit on the whole document, which
// would otherwise also fire while typing in the sidebar filter, a dialog, or
// the find bar. xterm's hidden textarea (inside `.xterm`) is the deliberate
// exception — the chord is meant to fire there, per TerminalView's passthrough.
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
