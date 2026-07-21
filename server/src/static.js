'use strict';
// Serves the built client (client/dist) — the production story: same origin as
// the API, no Vite dev proxy needed. Deliberately NOT behind authMiddleware — the
// login page must load before there's a token; the token gates /api and the WS
// attach, not the page.
const path = require('path');
const fs = require('fs');
const express = require('express');

const DIST_DIR = path.join(__dirname, '..', '..', 'client', 'dist');

// Top-level namespaces the SPA fallback must never swallow into index.html.
// Anyone adding a new one in index.js (e.g. /healthz) MUST add it here too.
// Compared case-insensitively since Express's own mount matching is, so /API/x
// reaches this fallback having already fallen through the /api router.
const RESERVED_PREFIXES = ['/api', '/sessions'];

function isReservedPath(reqPath) {
  const p = reqPath.toLowerCase();
  return RESERVED_PREFIXES.some((r) => p === r || p.startsWith(`${r}/`));
}

// Returns a router serving the built client, or null with no build (dev — Vite
// owns the page). Checked once at startup: deploys restart the server anyway, so
// a dist appearing/disappearing/swapping mid-run isn't a supported state — it
// just degrades to sendFile ENOENT -> errorHandler's generic 500 per page load.
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

  // SPA fallback: any unmatched GET/HEAD gets index.html, except the reserved
  // namespaces and anything clearly an asset request (/assets/ or a file
  // extension). A tab open across a redeploy asking for an old-hash asset must
  // get a clean 404, not index.html — the browser would otherwise execute HTML
  // as JS and die on an opaque syntax error.
  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (isReservedPath(req.path)) return next();
    if (req.path.startsWith('/assets/') || /\.[^/]+$/.test(req.path)) return next();
    res.sendFile('index.html', {
      root: distDir,
      headers: { 'Cache-Control': 'no-cache' },
    }, err => { if (err) next(err); });
  });

  return router;
}

module.exports = { createStatic, DIST_DIR, RESERVED_PREFIXES };
