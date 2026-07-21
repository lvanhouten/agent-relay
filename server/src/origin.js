'use strict';
// Origin policy shared by REST CORS (index.js) and the WS upgrade gate (ws.js):
// the browser is a bridge (any page it visits can hit localhost), so listening on
// localhost filters nothing by itself. Passes: no-Origin (non-browser,
// token-gated), loopback, same-origin, or AR_CORS_ORIGIN-allowlisted (comma-
// separated full origins). An Origin of "null" (sandboxed iframe/file://) fails
// URL parsing and is denied — such a page has no identity to trust.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseAllowlist(raw) {
  return (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

const ALLOWLIST = parseAllowlist(process.env.AR_CORS_ORIGIN);

// Additive to (never a replacement for) the static AR_CORS_ORIGIN allowlist —
// populated once the tunnel supervisor discovers the tailnet URL (see
// allowRuntimeOrigin below), since a tunneled page's Origin may not match the
// request's Host (unverified proxy passthrough).
const RUNTIME_ORIGINS = new Set();

// Registers a full origin so `originAllowed` treats it like an allowlisted one,
// regardless of the request's Host header. Idempotent (backed by a Set).
function allowRuntimeOrigin(origin) {
  if (!origin) return;
  RUNTIME_ORIGINS.add(origin);
}

// origin = the request's Origin header (undefined for non-browser clients);
// host = its Host header. allowlist/runtimeOrigins are injectable for tests.
function originAllowed(origin, host, allowlist = ALLOWLIST, runtimeOrigins = RUNTIME_ORIGINS) {
  if (origin === undefined || origin === '') return true;
  let url;
  try { url = new URL(origin); } catch { return false; }
  if (LOOPBACK.has(url.hostname)) return true;
  if (host && url.host === host) return true;
  if (runtimeOrigins.has(origin)) return true;
  return allowlist.includes(origin);
}

module.exports = { originAllowed, parseAllowlist, allowRuntimeOrigin };
