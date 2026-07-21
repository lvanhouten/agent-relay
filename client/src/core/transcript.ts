// Filename formatting for the transcript download. Pure over an explicit ISO
// timestamp (caller passes new Date().toISOString()) so it's unit-testable
// without a clock; the Blob-save itself is an impure one-liner in the screen.

// `<slug>-<stamp>.txt`, where slug is the session name reduced to filesystem-safe
// characters and stamp is the ISO instant with colons swapped for dashes and the
// sub-second fraction dropped (2026-07-06T14-30-00Z).
export function transcriptFilename(name: string, iso: string): string {
  const slug =
    (name || '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'session';
  const stamp = iso.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  return `${slug}-${stamp}.txt`;
}

// SerializeAddon reproduces terminal STATE (colors, attributes, cursor moves)
// as escape sequences — right for replaying, wrong for the .txt we ship
// (Notepad shows raw \x1b[...m noise). Strips CSI, OSC, and stray single-char
// escapes; text content untouched. DCS/APC/PM/SOS payloads are NOT stripped —
// SerializeAddon never emits them, so handling them would be dead code.
export function stripAnsi(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')          // CSI ... final byte
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')  // OSC ... BEL | ST
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[@-Z\\-_]/g, '');                     // other two-byte escapes
}
