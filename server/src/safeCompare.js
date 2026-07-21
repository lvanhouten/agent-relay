'use strict';
// The web tier's one constant-time compare, shared by auth.js's token check and
// cookie.js's HMAC check so they can't drift. Length is compared first (leaks
// only length, not bytes); the byte compare is constant-time via timingSafeEqual,
// which throws on unequal-length buffers, so non-string/mismatched-length inputs
// reject before reaching it.
//
// NOT shared with board/lib.js's secretEqual: that twin lives in the board
// kernel, an independent package with no server/src dependency — keep it
// hand-synced; everything under server/src imports this one.
const crypto = require('crypto');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = { safeEqual };
