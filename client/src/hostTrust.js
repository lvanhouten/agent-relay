// Pure host-URL helpers, React-free so they're unit-testable standalone.
// `isLocalhost` backs LoginScreen's cleartext gate; `normalizeHost` is its
// scheme-tolerant helper.

// `new URL('localhost:3017')` treats 'localhost' as the scheme with an empty
// hostname - prepend http:// so isLocalhost() always sees a real hostname.
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
