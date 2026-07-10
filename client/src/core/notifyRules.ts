// Pure reducer deciding which needs-input transitions deserve a desktop
// notification. Diffs two consecutive session-poll results — no Notification
// API access here; the notifications hook owns permission/firing/click wiring, this
// module owns only the "what" and "whether".
//
// Transition-based, not state-based (VC-23): the pulsing sidebar dot is the
// persistent needs-input signal, so this reducer only fires the instant a
// session *enters* needs-input, never for staying in it or for a session that
// arrives already flagged (a first poll after page load or a web-tier
// restart would otherwise burst-notify for every already-blocked session).

import type { Session } from './types.ts';

export interface NotificationSpec {
  sessionId: string;
  tag: string;
  title: string;
  body: string;
}

// The session name is operator- (or, in the pairing model, paired-device-)
// supplied and flows straight into the OS notification title/body — the
// least-context surface there is, where a garbled or spoofed name is least
// likely to be caught. Strip C0/C1 controls, zero-width joiners/marks, and
// bidi-override characters (which can reorder or hide text), then cap the
// length before interpolating. Rendering-only defense — crosses no
// code-execution boundary — but cheap, mirroring transcript.ts's allowlist.
// Built from a string so the source stays pure ASCII (no literal control chars).
const UNSAFE_NAME_CHARS = new RegExp(
  '[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]',
  'g',
);

export function notifyName(name: string, max = 60): string {
  const clean = (name ?? '').replace(UNSAFE_NAME_CHARS, '').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

export function notifyTransitions(
  prev: Session[],
  next: Session[],
  windowFocused: boolean,
): NotificationSpec[] {
  // The pulsing dot already carries the signal while focused; notifications
  // are the pull-back channel for when the user isn't looking.
  if (windowFocused) return [];

  const prevById = new Map(prev.map((s) => [s.id, s]));
  const specs: NotificationSpec[] = [];

  for (const session of next) {
    if (session.status !== 'needs-input') continue;

    const before = prevById.get(session.id);
    // Absent from the previous list: this is the session's first appearance,
    // not an observed transition into needs-input.
    if (before === undefined) continue;
    // Already needs-input last poll: no transition, nothing to (re-)fire.
    if (before.status === 'needs-input') continue;

    const safeName = notifyName(session.name);
    specs.push({
      sessionId: session.id,
      tag: session.id,
      title: `${safeName} needs input`,
      body: `${safeName} is waiting on you.`,
    });
  }

  return specs;
}
