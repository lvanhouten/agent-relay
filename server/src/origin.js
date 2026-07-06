'use strict';
// Origin policy shared by the REST CORS config (index.js) and the WS upgrade
// gate (ws.js). The operator's browser is a bridge: any page it visits can issue
// requests to localhost, so "listening on localhost" filters nothing by itself.
// This module decides which *pages* (origins) may talk to the relay:
//   - non-browser clients (no Origin header) pass — the token is their gate;
//   - loopback origins pass (the Vite dev client on :5173, a same-machine page);
//   - same-origin passes (the production client served by this server, or a
//     tunnel in front of it — the Origin's host equals the request's Host);
//   - anything else must be allowlisted via AR_CORS_ORIGIN (comma-separated
//     full origins, e.g. https://relay.example.com).
// An Origin of "null" (sandboxed iframe, file:// page) fails URL parsing and is
// denied — such a page has no identity to trust.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseAllowlist(raw) {
  return (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

const ALLOWLIST = parseAllowlist(process.env.AR_CORS_ORIGIN);

// Runtime-registered origins: additive to (never a replacement for) the
// static AR_CORS_ORIGIN allowlist. Populated at startup by the wiring layer
// once the tunnel supervisor discovers the tailnet URL (see allowRuntimeOrigin
// below) — a tunneled page's Origin won't necessarily match the request's Host
// header (unverified proxy Host-passthrough), so it needs its own gate rather
// than relying on the same-origin check.
const RUNTIME_ORIGINS = new Set();

// Registers a full origin (scheme + host + port) so `originAllowed` treats it
// exactly like an allowlisted origin, regardless of the request's Host header.
// Idempotent — registering the same origin twice is a no-op (backed by a Set).
function allowRuntimeOrigin(origin) {
  if (!origin) return;
  RUNTIME_ORIGINS.add(origin);
}

// origin = the request's Origin header (undefined for non-browser clients),
// host = its Host header. allowlist is injectable for tests; runtimeOrigins
// defaults to the module-level set mutated by allowRuntimeOrigin.
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
