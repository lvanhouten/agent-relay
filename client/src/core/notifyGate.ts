// Pure resolution of the bell toggle's two inputs — the user's persisted opt-in
// and the origin-global Notification permission — into the one boolean the hook
// fires on and the one enum the chrome renders. No Notification API access here;
// the platform-support probe and permission read live in the hook, this module
// only combines their results so the combination logic is unit-testable.

export type PermissionState = 'default' | 'granted' | 'denied';

// 'unsupported' — no Notification API on this platform; toggle is inert.
// 'blocked'     — permission denied at the origin; re-enabling can't help.
// 'on'/'off'    — user opt-in state while permission allows it.
export type ToggleView = 'on' | 'off' | 'blocked' | 'unsupported';

export function toggleView(
  supported: boolean,
  enabled: boolean,
  permission: PermissionState,
): ToggleView {
  if (!supported) return 'unsupported';
  if (permission === 'denied') return 'blocked';
  return enabled && permission === 'granted' ? 'on' : 'off';
}

// Whether a returned spec should actually become a Notification. Firing requires
// all three: a supporting platform, the user's opt-in, and granted permission.
export function canNotify(
  supported: boolean,
  enabled: boolean,
  permission: PermissionState,
): boolean {
  return supported && enabled && permission === 'granted';
}
