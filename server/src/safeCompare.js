'use strict';
// The web tier's one constant-time string compare, shared by every server/src
// consumer (auth.js's HTTP-token check and cookie.js's HMAC-signature check) so
// the two can never drift on their timing/rejection behavior. Length is compared
// first (unavoidably non-constant on length, which leaks only the operand's
// length, not its bytes); the byte comparison itself is constant-time via
// timingSafeEqual. Non-string / mismatched-length inputs reject without ever
// reaching timingSafeEqual (which throws on unequal-length buffers).
//
// NOT shared with board/lib.js's secretEqual: that twin lives in the board
// kernel, an independent package that runs standalone (sb / mcp-server) with no
// dependency on server/src. Keep the *board* twin hand-synced; everything under
// server/src imports this one.
const crypto = require('crypto');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = { safeEqual };
