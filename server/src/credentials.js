'use strict';
// Persisted server credentials: the access token and the cookie-signing secret,
// stored together in one owner-only JSON file so a restart doesn't silently
// invalidate every logged-in client (ADR 0001 — an unstable token reads as a
// broken app). Mirrors the board's per-boot pipe-secret pattern
// (server/board/lib.js SECRET_DIR/persistSecret) but is deliberately NOT
// imported from there: the board kernel is an independent package that runs
// standalone (sb / mcp-server) with no dependency on server/src, so the
// directory-resolution logic is duplicated by hand (same reasoning as
// auth.js's safeEqual vs board/lib.js's secretEqual).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const CREDENTIALS_DIR = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agent-relay')
  : path.join(os.homedir(), '.agent-relay');
const credentialsPath = () => path.join(CREDENTIALS_DIR, 'credentials.json');

// Same entropy as the token resolveToken used to generate per-run.
function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function generateSigningSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

// Absent, unreadable, or corrupt (junk bytes / invalid JSON) are all treated
// identically: "nothing usable on disk" — regenerate, never throw.
function readCredentialsFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeCredentialsFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
}

function str(v) {
  return typeof v === 'string' && v ? v : null;
}

// Resolve { token, generated, signingSecret } for this run.
//   - AR_NO_AUTH=1        -> token: null (auth disabled). Signing secret is
//                            still resolved so downstream modules never handle
//                            a null secret.
//   - AR_TOKEN set        -> that token, generated: false. Nothing about the
//                            token is written to disk (a pinned token is never
//                            persisted), but the signing secret still is.
//   - otherwise           -> reuse the persisted token if present; else
//                            generate + persist one (generated: true only when
//                            a fresh token was minted THIS load).
// The signing secret is always generated-once-and-reused from the same file,
// independent of how the token resolved above.
//
// `env`/`file` are injectable — same design as auth.js's resolveToken, so all
// shapes are unit-testable without subprocess env games or touching the real
// app-data path.
function loadCredentials(env, file = credentialsPath()) {
  const existing = readCredentialsFile(file) || {};
  const storedToken = str(existing.token);
  let signingSecret = str(existing.signingSecret);

  let token;
  let generated = false;
  let tokenToPersist = storedToken;

  if (env.AR_NO_AUTH === '1') {
    token = null;
  } else if (env.AR_TOKEN) {
    token = env.AR_TOKEN;
    // tokenToPersist stays storedToken — the pinned token is never written.
  } else if (storedToken) {
    token = storedToken;
  } else {
    token = generateToken();
    generated = true;
    tokenToPersist = token;
  }

  let needsWrite = false;
  if (!signingSecret) {
    signingSecret = generateSigningSecret();
    needsWrite = true;
  }
  if (tokenToPersist !== storedToken) {
    needsWrite = true;
  }

  if (needsWrite) {
    writeCredentialsFile(file, { token: tokenToPersist, signingSecret });
  }

  return { token, generated, signingSecret };
}

module.exports = { loadCredentials, credentialsPath };
