'use strict';
// Persisted server credentials (token + cookie-signing secret) in one owner-only
// JSON file, so a restart doesn't invalidate every logged-in client. Mirrors
// board/lib.js's pipe-secret pattern but isn't imported from it — the board
// kernel runs standalone with no server/src dependency, so this is hand-
// duplicated (same reasoning as auth.js's safeEqual vs board/lib.js's secretEqual).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const CREDENTIALS_DIR = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agent-relay')
  : path.join(os.homedir(), '.agent-relay');
const credentialsPath = () => path.join(CREDENTIALS_DIR, 'credentials.json');

// Same entropy as auth.js's resolveToken generates.
function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function generateSigningSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

// Absent/unreadable/corrupt all mean the same thing: nothing usable — regenerate, never throw.
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

// Resolves { token, generated, signingSecret }: AR_NO_AUTH=1 -> token null;
// AR_TOKEN set -> that token, never persisted; otherwise reuse or generate+persist
// one (generated: true only when freshly minted this load). The signing secret is
// always generated-once-and-reused regardless of how the token resolved.
// `env`/`file` are injectable, same design as auth.js's resolveToken, so every
// shape is testable without touching the real app-data path.
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
