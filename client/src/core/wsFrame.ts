// Parses a raw WS text frame into a dispatchable object, or null if unusable.
//
// The hazard: JSON.parse succeeds on valid-but-non-object JSON (`null`, a bare
// number, a string), so a naive `.type` access throws *outside* the parse
// try/catch, freezing the terminal ("online but silently stops receiving").
// Returning null lets the caller drop such a frame instead of throwing.
//
// Return type is deliberately not ServerFrame: this only guarantees a non-null
// object envelope, nothing about `type` or per-type payload shapes.
export function parseFrame(raw: string): Record<string, unknown> | null {
  let msg: unknown;
  try { msg = JSON.parse(raw); } catch { return null; }
  if (!msg || typeof msg !== 'object') return null;
  return msg as Record<string, unknown>;
}

// parseFrame guarantees only a non-null object envelope, nothing about a given
// `type`'s payload shape. A 'data' frame's payload feeds straight into xterm's
// term.write(), which throws on anything but a string — reopening the same
// failure mode one field deeper.
export function isValidDataPayload(
  msg: Record<string, unknown>,
): msg is Record<string, unknown> & { payload: string } {
  return typeof msg.payload === 'string';
}

// Same per-type guard for the 'exit' frame's code. Unlike the data payload
// (dropped when invalid), an exit frame always ends the session — the caller
// normalizes an invalid code instead of ignoring the frame, so a malformed
// exit can't strand the client reconnecting to a dead line.
export function isValidExitCode(
  msg: Record<string, unknown>,
): msg is Record<string, unknown> & { code: number | null } {
  return typeof msg.code === 'number' || msg.code === null;
}
