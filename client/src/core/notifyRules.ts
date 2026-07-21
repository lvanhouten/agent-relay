// Pure reducer deciding which needs-input transitions deserve a desktop
// notification. Diffs two consecutive polls; the hook owns permission/firing.
//
// Transition-based, not state-based: fires only the instant a session *enters*
// needs-input, never for staying in it or arriving already flagged — otherwise
// a first poll after page load would burst-notify every already-blocked session.

import type { Session } from './types.ts';

export interface NotificationSpec {
  sessionId: string;
  tag: string;
  title: string;
  body: string;
}

// Session names are operator/paired-device-supplied and flow straight into the
// OS notification title/body, the least-context surface for a spoofed name to
// slip by. Strip C0/C1 controls, zero-width/bidi-override chars, then cap
// length. Rendering-only defense, cheap, mirrors transcript.ts's allowlist.
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
  // The pulsing dot covers the focused case; notifications are the pull-back
  // channel for when the user isn't looking.
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
