'use strict';
// Pairing router. Two endpoints, both mounted under /api by the wiring brief
// (07) behind the same dual-auth gate as createAPI — this router itself
// applies no auth, matching api.js's style:
//
//   POST /api/login  — mints the browser's auth cookie. Demands the BEARER token
//                      specifically (reusing auth.js's constant-time checkToken),
//                      so an ambient auth cookie can NOT mint another cookie: this
//                      is the one place cookies are issued. Takes no body — the
//                      bearer requirement alone blocks a cross-site form POST (a
//                      "simple" cross-site request can't set an Authorization
//                      header, and the cookie doesn't satisfy this handler), on
//                      top of the origin gate + SameSite=Strict the cookie carries.
//   GET  /api/pairing — returns tunnel status and, only when the tunnel is UP, the
//                      pairing URL https://<tunnel-host>/#token=<access token>. The
//                      token rides the URL FRAGMENT, never a query string, so it is
//                      never sent to the tunnel host / logged in an access log.
//                      Tunnel down/disabled → pairingUrl: null (a localhost URL is
//                      unreachable from the device being paired) + the status reason.
//
// Accepted property (PRD): any authenticated caller can recover the
// token via GET /api/pairing — deliberate for single-operator headless pairing.
//
// Factory over injected collaborators, matching api.js: the access token, the
// constant-time checkToken, the cookie module's issue/setCookieHeader, the signing
// secret issue() is keyed on, and the tunnel supervisor's status() getter (shape
// { state:'up'|'down'|'disabled', url, reason }). All injected so the whole router
// is unit-testable without the credentials file, a live tunnel, or the board.
const { Router } = require('express');

// The Set-Cookie Secure flag must be set exactly when the request arrived over
// https — a Secure cookie over plain http is silently never stored. Honor both a
// direct TLS connection (req.secure, which also respects Express `trust proxy`)
// and an explicit proxy-forwarded proto indication, so a relay behind a TLS-
// terminating tunnel/proxy still mints a Secure cookie.
function requestIsHttps(req) {
  if (req.secure) return true;
  const xfp = req.headers['x-forwarded-proto'];
  if (typeof xfp === 'string' && xfp.split(',')[0].trim().toLowerCase() === 'https') return true;
  return false;
}

function bearerFrom(req) {
  const header = req.headers['authorization'] ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

// The one place the token-bearing pairing URL is formatted, called by BOTH the
// GET /api/pairing response and index.js's console QR so they can never diverge.
// The token rides the URL FRAGMENT, never a query string, so it is never sent to
// the tunnel host / written to an access log — this format is the no-logs
// guarantee, so it lives in exactly one function.
function pairingUrl(tunnelUrl, token) {
  const host = new URL(tunnelUrl).host;
  return `https://${host}/#token=${encodeURIComponent(token)}`;
}

function createPairing({ token, checkToken, issue, setCookieHeader, signingSecret, tunnelStatus }) {
  const r = Router();

  r.post('/login', (req, res) => {
    // Bearer-specifically, not the dual gate: a cookie must not mint a cookie.
    // Reuses auth.js's constant-time checkToken (not a fresh compare) so timing
    // behavior matches every other token check.
    if (!checkToken(bearerFrom(req), token)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    res.setHeader('Set-Cookie', setCookieHeader(issue(signingSecret), { secure: requestIsHttps(req) }));
    return res.status(204).end();
  });

  r.get('/pairing', (_req, res) => {
    const s = tunnelStatus();
    // Only { state, reason } is exposed — never the raw local url, which is
    // useless to the paired device and is only ever surfaced as the fragment URL.
    const tunnel = { state: s.state, reason: s.reason };
    let url = null;
    // s.url is non-null IFF state === 'up' (tunnel supervisor invariant), but gate
    // on state to make the contract explicit and to never emit a null-host URL.
    if (s.state === 'up' && s.url) {
      url = pairingUrl(s.url, token);
    }
    return res.json({ tunnel, pairingUrl: url });
  });

  return r;
}

module.exports = { createPairing, pairingUrl };
