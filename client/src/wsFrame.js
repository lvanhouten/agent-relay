// Parse a raw WS text frame into a dispatchable message object, or null if it's
// unusable. Kept pure/React-free so the malformed-frame guard is unit-testable.
//
// The hazard (N4): JSON.parse succeeds on valid-but-non-object JSON — `null`, a
// bare number, a string — so a naive `JSON.parse(raw).type` throws on null (or
// silently misbehaves on a primitive) *outside* the parse try/catch, freezing the
// terminal ("online but silently stops receiving"). Returning null here lets the
// caller drop such a frame instead of throwing.
export function parseFrame(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return null; }
  if (!msg || typeof msg !== 'object') return null;
  return msg;
}
