import React from 'react';
import { notifyTransitions } from './notifyRules.ts';
import { canNotify, toggleView, toggleAction } from './notifyGate.ts';
import type { PermissionState, ToggleView } from './notifyGate.ts';
import type { Session } from './types.ts';

// The desktop shell's notification wiring: permission state, the Notification
// constructor, and the click handler. Every decision about *whether* a spec
// fires lives in notifyTransitions (brief 02) — this hook adds only the
// enable/permission gate around it, no ad-hoc focus checks.
//
// Desktop-only: the mobile shell never mounts this. localStorage (not
// sessionStorage) is deliberate — Notification permission is origin-global and
// the mobile shell never notifies, so sharing the opt-in across windows is
// harmless, unlike the per-window shell override.

const STORAGE_KEY = 'ar-desktop-notify';

function isSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function currentPermission(): PermissionState {
  return isSupported() ? (Notification.permission as PermissionState) : 'denied';
}

export interface DesktopNotifications {
  view: ToggleView;
  toggle: () => void;
}

export function useDesktopNotifications(
  sessions: Session[],
  onSelect: (id: string) => void,
): DesktopNotifications {
  const supported = isSupported();
  const [enabled, setEnabled] = React.useState<boolean>(
    () => supported && localStorage.getItem(STORAGE_KEY) === '1',
  );
  const [permission, setPermission] = React.useState<PermissionState>(currentPermission);

  // onSelect's identity may change across renders; a stable ref keeps a fired
  // notification's click handler pointed at the latest selector without making
  // the diff effect re-subscribe.
  const onSelectRef = React.useRef(onSelect);
  onSelectRef.current = onSelect;

  const toggle = React.useCallback(() => {
    if (!supported) return;
    // Branch on the resolved (enabled + permission) state, not the raw opt-in:
    // a stale enabled=true whose permission has since lapsed must re-request,
    // not take the disable branch and silently no-op (toggleAction).
    if (toggleAction(enabled, permission) === 'disable') {
      setEnabled(false);
      localStorage.setItem(STORAGE_KEY, '0');
      return;
    }
    // Enabling is the ONLY place permission is ever requested — never on load.
    Notification.requestPermission().then((result) => {
      const perm = result as PermissionState;
      setPermission(perm);
      const granted = perm === 'granted';
      setEnabled(granted);
      localStorage.setItem(STORAGE_KEY, granted ? '1' : '0');
    });
  }, [supported, enabled, permission]);

  // Diff consecutive poll results and fire per returned spec. prevRef always
  // advances (even while disabled) so enabling mid-stream never retroactively
  // fires for a transition observed while off — we only ever diff the two most
  // recent polls, and gate the firing on canNotify.
  const prevRef = React.useRef<Session[]>(sessions);
  React.useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = sessions;
    if (!canNotify(supported, enabled, permission)) return;
    const specs = notifyTransitions(prev, sessions, document.hasFocus());
    for (const spec of specs) {
      const n = new Notification(spec.title, { body: spec.body, tag: spec.tag });
      n.onclick = () => {
        window.focus();
        onSelectRef.current(spec.sessionId);
        n.close();
      };
    }
  }, [sessions, supported, enabled, permission]);

  return { view: toggleView(supported, enabled, permission), toggle };
}
