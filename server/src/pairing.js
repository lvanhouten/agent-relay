'use strict';
// Pairing router: two endpoints mounted under /api behind the same dual-auth
// gate as createAPI — this router itself applies no auth.
//
// POST /login mints the auth cookie — requires the BEARER token specifically
// (not the dual gate), so an ambient cookie can't mint another cookie; the
// bearer requirement alone blocks a cross-site form POST.
// GET /pairing returns tunnel status and, only when up, the pairing URL with the
// token in the URL FRAGMENT (never a query string, so it's never logged or sent
// to the tunnel host). Tunnel down/disabled -> pairingUrl: null + the reason.
//
// Accepted: any authenticated caller can recover the token via GET /pairing —
// deliberate for single-operator headless pairing.
//
// Factory over injected collaborators (token, checkToken, cookie issue/
// setCookieHeader, signing secret, tunnel status getter) so the whole router is
// unit-testable without the credentials file, a live tunnel, or the board.
const { Router } = require('express');

// Secure must be set exactly when the request arrived over https, or it's
// silently never stored. Honors both a direct TLS connection (req.secure) and an
// explicit x-forwarded-proto, so a relay behind a TLS-terminating proxy still
// mints a Secure cookie.
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
// GET /api/pairing response and index.js's console QR so they can never diverge —
// the no-logs guarantee (token in the fragment, never a query string) lives here alone.
function pairingUrl(tunnelUrl, token) {
  const host = new URL(tunnelUrl).host;
  return `https://${host}/#token=${encodeURIComponent(token)}`;
}

function createPairing({ token, checkToken, issue, setCookieHeader, signingSecret, tunnelStatus }) {
  const r = Router();

  r.post('/login', (req, res) => {
    // Reuses auth.js's checkToken (not a fresh compare) so timing matches every
    // other token check.
    if (!checkToken(bearerFrom(req), token)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    res.setHeader('Set-Cookie', setCookieHeader(issue(signingSecret), { secure: requestIsHttps(req) }));
    return res.status(204).end();
  });

  r.get('/pairing', (_req, res) => {
    const s = tunnelStatus();
    // Only { state, reason } is exposed — the raw local url is useless to the
    // paired device and only ever surfaced as the fragment URL.
    const tunnel = { state: s.state, reason: s.reason };
    let url = null;
    // s.url is non-null IFF state==='up' (tunnel invariant); gate on state anyway
    // so a null-host URL can never emit.
    if (s.state === 'up' && s.url) {
      url = pairingUrl(s.url, token);
    }
    return res.json({ tunnel, pairingUrl: url });
  });

  return r;
}

module.exports = { createPairing, pairingUrl };
