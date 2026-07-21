// Reads the pairing token from a URL fragment (`#token=<value>`), used instead
// of `?token=` because fragments never reach the server (no Referer, no
// access-log line).
//
// Window-free by design: callers pass `location.hash`/`.href` so this stays
// pure. The strip side effect (`history.replaceState`, done before any network
// call) belongs to the caller, not here.

// Accepts the hash with or without its leading '#' (callers may pass
// `location.hash`, which always includes it, or a bare fragment body).
export function readFragmentToken(hash: string): string | null {
  if (!hash) return null;
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!body) return null;

  // Only the first '&'-delimited segment counts — the pairing URL is exactly
  // one key, so a malformed/extra segment can't resurrect a non-match.
  const first = body.split('&', 1)[0];
  const eq = first.indexOf('=');
  if (eq === -1) return null;

  const key = first.slice(0, eq);
  const rawValue = first.slice(eq + 1);
  if (key !== 'token' || !rawValue) return null;

  // The token is base64url, so decoding is normally a no-op — but a raw read
  // must never throw on a malformed percent-escape (e.g. a truncated '%'),
  // which would otherwise blow up the boot flow before login even renders.
  try {
    const value = decodeURIComponent(rawValue);
    return value || null;
  } catch {
    return null;
  }
}

// The same href with the fragment removed, for the caller's
// history.replaceState. Preserves path and query — only `#...` (and
// everything after it) is dropped.
export function stripFragment(href: string): string {
  const idx = href.indexOf('#');
  return idx === -1 ? href : href.slice(0, idx);
}
