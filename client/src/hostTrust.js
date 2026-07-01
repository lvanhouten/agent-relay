// Pure host-URL helpers used by LoginScreen's trust gate. Kept React-free so the
// parsing/normalization logic can be unit-tested without rendering the component.

// Normalize a relay host to an absolute URL with a scheme. A scheme-less
// `host:port` shorthand (e.g. `localhost:3017`, which the placeholder invites) is
// NOT a malformed URL — `new URL('localhost:3017')` parses with an empty hostname
// and treats `localhost` as the scheme — so without this it would slip past the
// malformed-host guard AND misclassify as a remote host in isLocalhost(). Prepend
// http:// when no `scheme://` prefix is present so every downstream consumer
// (validation, isLocalhost, fetch) sees a consistent absolute URL.
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
