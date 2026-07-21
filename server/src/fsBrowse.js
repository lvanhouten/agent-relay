'use strict';
const fs = require('fs');
const path = require('path');
const { resolveCwd } = require('./paths');

// Caps entries so C:\Windows or a node_modules browsed one level too high can't
// turn into a multi-MB response or a frozen list on the phone.
const ENTRY_CAP = 500;

// Read-only directory listing for the create dialog's "Browse…" picker — lists
// the BOARD's filesystem (the shell-spawning machine), not the operator's device
// (a tunneled phone is a different disk). Walks the same path resolveCwd/pty.spawn use.
//
// TRUST: gated by the same authMiddleware as every /api route. A token holder can
// already spawn a shell in any cwd via POST /sessions, so a read-only listing
// grants strictly less — no new boundary.
//
// Lists real directories only (Dirent.isDirectory()); symlinked/junction dirs are
// deliberately not surfaced (would need a per-entry stat and risks the realpath
// loop parentOf avoids). Filesystem errors map to a typed { error } for 4xx; only
// an unexpected failure rethrows.
async function browseDir(input) {
  const resolved = path.resolve(resolveCwd(input));
  let dirents;
  try {
    dirents = await fs.promises.readdir(resolved, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return { error: 'not-found', path: resolved };
    if (e.code === 'ENOTDIR') return { error: 'not-a-directory', path: resolved };
    if (e.code === 'EACCES' || e.code === 'EPERM') return { error: 'denied', path: resolved };
    throw e;
  }
  const dirs = dirents.filter((d) => d.isDirectory());
  const truncated = dirs.length > ENTRY_CAP;
  // Sort before capping so truncation keeps the alphabetical head, not OS order;
  // case-insensitive since users don't scan in ASCII casing.
  const entries = dirs
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    .slice(0, ENTRY_CAP)
    .map((d) => ({ name: d.name, isDir: true }));
  return { path: resolved, parent: parentOf(resolved), entries, truncated };
}

// Parent dir, or null at a filesystem root (dirname of a root returns itself,
// which would loop; null tells the client to hide the up affordance). Computed
// lexically, never realpath-followed, so a junction pointing back up its own
// tree can't send the breadcrumb into an infinite climb.
function parentOf(resolved) {
  const parent = path.dirname(resolved);
  return parent === resolved ? null : parent;
}

module.exports = { browseDir, ENTRY_CAP };
