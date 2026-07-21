// Pure resolution of the bell toggle's two inputs — persisted opt-in and the
// origin-global Notification permission — into the boolean the hook fires on
// and the enum the chrome renders. No Notification API access here; the hook
// owns the probe/read, this module only combines the results.

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

// The bell toggle's branch decision. Disable ONLY when actually live (opted in
// AND granted); otherwise request permission. A stale enabled=true paired with
// a lapsed permission (auto-revocation, or a manual reset — neither clears
// localStorage) must fall through to a fresh request, not silently no-op.
export function toggleAction(
  enabled: boolean,
  permission: PermissionState,
): 'disable' | 'request' {
  return enabled && permission === 'granted' ? 'disable' : 'request';
}
