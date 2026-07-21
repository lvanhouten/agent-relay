// Boot-time shell selection: decides `mobile` vs `desktop` from window
// geometry, with a per-window manual override that beats the heuristic either
// way. Pure — no DOM access — the caller measures the window and passes plain
// numbers.
//
// Storage is injected so this module never assumes a global `sessionStorage`.
// The override is scoped per-window (sessionStorage, never localStorage): a
// desk-side "force desktop" must never leak into a phone-over-RDP window
// sharing the same origin.

export type ShellKind = 'mobile' | 'desktop';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const OVERRIDE_KEY = 'ar-shell-override';

// A window is phone-shaped iff portrait (taller than wide) or narrower than
// 768 CSS px. Deliberately width/height only, no pointer/UA sniffing —
// phone-over-RDP is desktop Chrome + mouse, so those would misclassify it.
function isPhoneShaped(width: number, height: number): boolean {
  return height > width || width < 768;
}

export function decideShell(input: { width: number; height: number; override: ShellKind | null }): ShellKind {
  if (input.override !== null) return input.override;
  return isPhoneShaped(input.width, input.height) ? 'mobile' : 'desktop';
}

function isShellKind(value: unknown): value is ShellKind {
  return value === 'mobile' || value === 'desktop';
}

// Garbage in storage (unset key, foreign value, or a storage that throws on
// read) reads as "no override" — never an exception, never a misread of junk.
export function readShellOverride(storage: StorageLike): ShellKind | null {
  let raw: string | null;
  try {
    raw = storage.getItem(OVERRIDE_KEY);
  } catch {
    return null;
  }
  return isShellKind(raw) ? raw : null;
}

// null clears the override. Storage exceptions (quota, private-mode) are
// swallowed — a failed persist must not crash the toggle that triggered it.
export function writeShellOverride(storage: StorageLike, kind: ShellKind | null): void {
  try {
    if (kind === null) storage.removeItem(OVERRIDE_KEY);
    else storage.setItem(OVERRIDE_KEY, kind);
  } catch {
    // swallow
  }
}
