// Reads the pairing token carried in a URL fragment (`#token=<value>`) — the
// QR-pairing handoff (PRD.md's pairing-endpoints brief prints
// `https://<tunnel-host>/#token=<access token>` as a QR code). Fragments never
// reach the server (no Referer, no server access log line, unlike a query
// string), which is why the token rides here instead of `?token=`.
//
// Deliberately window-free: callers pass `location.hash` (or `.href` to
// stripFragment) so this module stays pure and unit-testable. The strip side
// effect itself — `history.replaceState` on the stripped href, done
// immediately after reading and before any network call — belongs to the
// caller (client-boot-flow brief), not here.

// Accepts the hash with or without its leading '#' (callers may pass
// `location.hash`, which always includes it, or a bare fragment body).
export function readFragmentToken(hash: string): string | null {
  if (!hash) return null;
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!body) return null;

  // Only the first '&'-delimited segment is considered — the pairing URL
  // shape is exactly one key. A malformed/extra segment after '&' doesn't
  // resurrect a non-pairing fragment into a match.
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
