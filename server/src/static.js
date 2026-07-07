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

// Top-level namespaces the SPA fallback must never swallow — it next()s them
// (→ 404) instead of serving index.html. Exported for the mount site: anyone
// adding a new top-level route namespace in index.js (e.g. /healthz) must add
// it here, or the fallback answers its unknown paths with HTML. Compared
// case-insensitively because Express's own mount matching is case-insensitive
// by default, so /API/x reaches this fallback having already fallen through
// the /api router.
const RESERVED_PREFIXES = ['/api', '/sessions'];

function isReservedPath(reqPath) {
  const p = reqPath.toLowerCase();
  return RESERVED_PREFIXES.some((r) => p === r || p.startsWith(`${r}/`));
}

// Returns a router serving the built client, or null when there is no build
// (dev — the Vite server owns the page there). Checked once at startup, not per
// request: a build appearing mid-run needs a server restart, which --watch does
// anyway for any server change. The same restart assumption scopes out the
// reverse case: a dist removed/swapped mid-run degrades to sendFile ENOENT →
// errorHandler's generic 500 per page load — deliberate, since deploys restart
// the server and a non-atomic swap under a live one isn't a supported state.
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
  // the reserved namespaces above (/api's unknown paths must stay API 404s,
  // not HTML; /sessions is the WS namespace, where an HTTP GET is a mistake,
  // not a page load), and anything that was clearly an asset request: a path
  // under /assets/ or whose last segment carries a file extension. A tab left
  // open across a redeploy asks for /assets/app.<oldhash>.js, which the new
  // dist no longer has — answering 200 index.html makes the browser execute
  // HTML as JS and die on an opaque syntax error; a clean 404 says what
  // actually happened (reload the page).
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
