// The chip -> byte-sequence map behind the mobile answer mode's canned-key row,
// plus the composer's text->bytes framing. Shell-naive by design (like
// claudeFlags.ts) — the terminal/agent on the other end is the validator.

export interface KeyChip {
  // Face text on the chip.
  label: string;
  // Raw bytes written straight down the WS `input` frame on tap.
  seq: string;
  // Accessible label / tooltip when the face alone is cryptic (arrows, Ctrl+C).
  title?: string;
}

// One-tap answers to the prompts agents actually ask. Letter/digit chips send
// the BARE character, no trailing Enter — Claude Code's permission menus act
// on the keypress itself, and a free-form y/n prompt needs the char then the
// separate Enter chip. Auto-submit lives only in the composer (composerBytes).
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
  { label: 'x', seq: 'x', title: 'Type x' },
  { label: '1', seq: '1' },
  { label: '2', seq: '2' },
  { label: '3', seq: '3' },
];

// Bytes for a composer submit. Single-line text gets a trailing \r (submits
// like Enter would). Multi-line text is wrapped in a bracketed-paste envelope
// so the far side sees one paste, not N per-line submits — belt-and-suspenders
// since a native single-line <input> already strips newlines.
export function composerBytes(text: string): string {
  if (text.includes('\n')) return `\x1b[200~${text}\x1b[201~`;
  return text + '\r';
}
