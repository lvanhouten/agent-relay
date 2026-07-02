// Pure host-URL helpers. Kept React-free so the parsing/normalization logic can
// be unit-tested without rendering a component. `isLocalhost` backs LoginScreen's
// cleartext gate (is the current origin a loopback host?); `normalizeHost` is its
// scheme-tolerant helper.

// Normalize a host string to an absolute URL with a scheme. A scheme-less
// `host:port` shorthand (e.g. `localhost:3017`) is NOT a malformed URL —
// `new URL('localhost:3017')` parses with an empty hostname and treats
// `localhost` as the scheme — so without this it would misclassify as a remote
// host in isLocalhost(). Prepend http:// when no `scheme://` prefix is present so
// isLocalhost() always sees a consistent absolute URL. (An origin from
// window.location already carries a scheme and passes through unchanged.)
export function normalizeHost(h) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(h) ? h : `http://${h}`;
}

// localhost / loopback is inherently trusted — the token can't leave the machine.
export function isLocalhost(h) {
  try {
    const { hostname } = new URL(normalizeHost(h));
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch { return false; }
}
