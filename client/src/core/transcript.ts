// Filename formatting for the transcript download. Pure over an explicit ISO
// timestamp (the caller passes new Date().toISOString()) so it's unit-testable
// without a clock. The download itself — pulling the serialized buffer and
// triggering a Blob save — is an impure one-liner in the screen; only the naming
// has edge cases worth pinning (a session name with slashes/spaces, an empty
// name), so only that lives here.

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
