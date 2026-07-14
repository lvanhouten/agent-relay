'use strict';
const os = require('os');
const path = require('path');

// Expand a leading ~ and fall back to home. The board hands cwd straight to
// pty.spawn, which throws on a literal "~/". Shared by spawn (sessions.js) and
// the read-only directory browser (fsBrowse.js) so both resolve a typed path
// identically — a folder you browse to is the same folder you'd spawn into.
// Dependency-free on purpose: fsBrowse is a pure-fs module and must not pull in
// the board-client graph just to reach this helper.
function resolveCwd(cwd) {
  const raw = (cwd ?? '').trim();
  if (!raw) return os.homedir();
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(1).replace(/^[\\/]/, ''));
  }
  return raw;
}

module.exports = { resolveCwd };
