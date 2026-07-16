// Parse a raw WS text frame into a dispatchable message object, or null if it's
// unusable. Kept pure/React-free so the malformed-frame guard is unit-testable.
//
// The hazard: JSON.parse succeeds on valid-but-non-object JSON — `null`, a
// bare number, a string — so a naive `JSON.parse(raw).type` throws on null (or
// silently misbehaves on a primitive) *outside* the parse try/catch, freezing the
// terminal ("online but silently stops receiving"). Returning null here lets the
// caller drop such a frame instead of throwing.
//
// The return type is deliberately not ServerFrame: parseFrame only guarantees a
// non-null object envelope, nothing about `type` or per-type payload shapes.
export function parseFrame(raw: string): Record<string, unknown> | null {
  let msg: unknown;
  try { msg = JSON.parse(raw); } catch { return null; }
  if (!msg || typeof msg !== 'object') return null;
  return msg as Record<string, unknown>;
}

// parseFrame only guarantees the envelope is a non-null object — it says
// nothing about a given `type`'s payload shape. A 'data' frame's
// payload is fed straight into xterm.js's term.write(), which stringifies or
// throws on anything but a string, reopening the same failure mode one field
// deeper. Kept alongside parseFrame so the per-type payload guard is
// unit-testable the same way.
export function isValidDataPayload(
  msg: Record<string, unknown>,
): msg is Record<string, unknown> & { payload: string } {
  return typeof msg.payload === 'string';
}

// Same per-type guard for the 'exit' frame's code. server/src/ws.js only ever
// forwards a real child-process exit code (number | null), but the envelope
// guard doesn't validate per-type fields, and every value that reaches a
// consumer should pass a runtime predicate, not a type assertion. Unlike the
// data payload (where an invalid frame is dropped), an exit frame always ends
// the session — the caller normalizes an invalid code instead of ignoring the
// frame, so a malformed exit can't strand the client in a reconnect loop
// against a dead line.
export function isValidExitCode(
  msg: Record<string, unknown>,
): msg is Record<string, unknown> & { code: number | null } {
  return typeof msg.code === 'number' || msg.code === null;
}
