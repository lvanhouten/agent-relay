'use strict';
const os = require('os');
const path = require('path');

// Expands a leading ~ (falls back to home when empty) — the board hands cwd
// straight to pty.spawn, which throws on a literal "~/". Shared by spawn
// (sessions.js) and the read-only browser (fsBrowse.js) so both resolve
// identically. Dependency-free so fsBrowse (pure fs) doesn't pull in the
// board-client graph just for this.
function resolveCwd(cwd) {
  const raw = (cwd ?? '').trim();
  if (!raw) return os.homedir();
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(1).replace(/^[\\/]/, ''));
  }
  return raw;
}

module.exports = { resolveCwd };
