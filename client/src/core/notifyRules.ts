// Pure reducer deciding which needs-input transitions deserve a desktop
// notification. Diffs two consecutive session-poll results — no Notification
// API access here; brief 06's hook owns permission/firing/click wiring, this
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

    specs.push({
      sessionId: session.id,
      tag: session.id,
      title: `${session.name} needs input`,
      body: `${session.name} is waiting on you.`,
    });
  }

  return specs;
}
