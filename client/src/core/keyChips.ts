// The chip -> byte-sequence map behind the mobile answer mode's canned-key row,
// plus the composer's text->bytes framing. Pure and shell-naive by design (like
// claudeFlags.ts): the terminal/agent on the other end is the validator. Kept
// here so the mapping is unit-tested directly rather than proven only as a named
// code path inside the screen (no component-test harness exists — see CLAUDE.md).

export interface KeyChip {
  // Face text on the chip.
  label: string;
  // Raw bytes written straight down the WS `input` frame on tap.
  seq: string;
  // Accessible label / tooltip when the face alone is cryptic (arrows, Ctrl+C).
  title?: string;
}

// One-tap answers to the prompts agents actually ask. Control/navigation keys
// send their raw sequence; the letter/digit chips send the BARE character with
// NO trailing Enter — Claude Code's permission menus act on the digit keypress
// itself, and a free-form y/n prompt is answered by tapping the char then the
// Enter chip (or by typing into the composer, whose Send appends \r). Keeping
// chips as pure single keys is the predictable model; auto-submit lives only in
// the composer. See composerBytes below.
export const KEY_CHIPS: readonly KeyChip[] = [
  { label: 'Enter', seq: '\r' },
  { label: 'Esc', seq: '\x1b' },
  { label: 'Ctrl+C', seq: '\x03', title: 'Interrupt (Ctrl+C)' },
  { label: 'Tab', seq: '\t' },
  { label: '↑', seq: '\x1b[A', title: 'Up arrow' },
  { label: '↓', seq: '\x1b[B', title: 'Down arrow' },
  { label: '←', seq: '\x1b[D', title: 'Left arrow' },
  { label: '→', seq: '\x1b[C', title: 'Right arrow' },
  { label: 'y', seq: 'y', title: 'Type y' },
  { label: 'n', seq: 'n', title: 'Type n' },
  { label: '1', seq: '1' },
  { label: '2', seq: '2' },
  { label: '3', seq: '3' },
];

// Bytes for a composer submit. A single-line entry sends the text plus \r so it
// submits, exactly as typing it and pressing Enter would. Multi-line text (a
// paste that slipped a newline in) is wrapped in a bracketed-paste envelope so
// the far side receives it as one paste rather than N per-line submits —
// mirroring the semantics switchboard's MCP send-input opt-in `paste` mode
// builds board-side. A native single-line <input> normally strips newlines, so
// the multi-line branch is belt-and-suspenders; it is still unit-tested.
export function composerBytes(text: string): string {
  if (text.includes('\n')) return `\x1b[200~${text}\x1b[201~`;
  return text + '\r';
}
