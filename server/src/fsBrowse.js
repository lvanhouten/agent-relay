'use strict';
const fs = require('fs');
const path = require('path');
const { resolveCwd } = require('./paths');

// Cap the entries returned so C:\Windows or a node_modules browsed one level too
// high can't turn into a multi-MB response or a frozen list on the phone.
const ENTRY_CAP = 500;

// Read-only directory listing for the new-session dialog's "Browse…" picker.
//
// The browsable filesystem is the BOARD's — the machine that spawns shells — not
// the operator's device: a phone on the tunnel is miles from it, so a browser
// file picker would list the wrong disk. A server endpoint is the only place the
// listing can come from, walking the same filesystem resolveCwd/pty.spawn touch.
//
// TRUST: gated by the same authMiddleware as every /api route — no new boundary.
// A token holder can already spawn a shell in any cwd via POST /sessions
// (ADR-0001's accepted ceiling); a read-only directory listing grants strictly
// less, so this widens nothing.
//
// Lists real directories only (Dirent.isDirectory()) — the field only ever wants
// a directory. Symlinked/junction directories are deliberately NOT surfaced in
// v1: that would need a per-entry stat and invites the realpath loop `parent`
// avoids below. Expected filesystem conditions (missing / not-a-dir / denied)
// return a typed { error } so the handler answers 4xx, never a 500; only a
// genuinely unexpected fs failure rethrows.
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
  // Sort before the cap so a truncated result keeps the alphabetical head, not
  // whatever order the OS handed back. Case-insensitive: a phone user scanning
  // the list doesn't think in ASCII casing.
  const entries = dirs
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    .slice(0, ENTRY_CAP)
    .map((d) => ({ name: d.name, isDir: true }));
  return { path: resolved, parent: parentOf(resolved), entries, truncated };
}

// The parent directory, or null at a filesystem root (a Windows drive root like
// C:\, or the POSIX /). path.dirname of a root returns the root itself, so a ".."
// there would loop in place; null tells the client to hide the up affordance.
// Computed lexically — never realpath/symlink-followed, so a junction pointing
// back up its own tree can't send the breadcrumb into an infinite climb.
function parentOf(resolved) {
  const parent = path.dirname(resolved);
  return parent === resolved ? null : parent;
}

module.exports = { browseDir, ENTRY_CAP };
