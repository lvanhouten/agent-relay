'use strict';
// Static serving of the built client (client/dist) — the production story: the
// SPA is served from the same origin as the API, so the same-origin model holds
// without the Vite dev proxy. Deliberately NOT behind authMiddleware — the login
// page must load before the user has a token; the token gates /api and the WS
// attach, not the page.
const path = require('path');
const fs = require('fs');
const express = require('express');

const DIST_DIR = path.join(__dirname, '..', '..', 'client', 'dist');

// Returns a router serving the built client, or null when there is no build
// (dev — the Vite server owns the page there). Checked once at startup, not per
// request: a build appearing mid-run needs a server restart, which --watch does
// anyway for any server change.
function createStatic(distDir = DIST_DIR) {
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) return null;

  const router = express.Router();

  router.use(express.static(distDir, {
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        // Vite content-hashes every file under assets/ — a changed file gets a
        // new URL, so the old one can be cached forever.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        // index.html (and anything unhashed from public/) is the mutable entry
        // point: always revalidate, or a deploy doesn't reach open browsers.
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

  // SPA fallback: any GET/HEAD that matched no file gets index.html — except
  // /api (its unknown paths must stay API 404s, not HTML) and /sessions (the WS
  // namespace; an HTTP GET there is a mistake, not a page load).
  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    if (req.path === '/sessions' || req.path.startsWith('/sessions/')) return next();
    res.sendFile('index.html', {
      root: distDir,
      headers: { 'Cache-Control': 'no-cache' },
    }, err => { if (err) next(err); });
  });

  return router;
}

module.exports = { createStatic, DIST_DIR };
