// Boot-time shell selection: decides `mobile` vs `desktop` from window
// geometry, with a per-window manual override that beats the heuristic in
// both directions. Pure — no DOM access — so the caller (app boot) measures
// the window and passes plain numbers; see _docs/CONTEXT.md "Shell
// selection" / "Phone-shaped window".
//
// Storage is injected rather than touched globally so this module (and its
// tests) never assume a global `sessionStorage`. Production callers pass
// `window.sessionStorage`: the override is scoped per-window (sessionStorage,
// never localStorage) because a desk-side "force desktop" must never leak
// into a phone-over-RDP window that happens to share the same origin.

export type ShellKind = 'mobile' | 'desktop';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const OVERRIDE_KEY = 'ar-shell-override';

// A window is phone-shaped iff it's portrait (taller than wide) or narrower
// than 768 CSS px. Deliberately width/height only, no pointer/UA sniffing —
// see the glossary entry for why (phone-over-RDP is desktop Chrome + mouse).
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

// Garbage in storage (unset key, a hand-edited/foreign value, or a storage
// that throws on read — e.g. private-mode restrictions) reads as "no
// override", never an exception and never a truthy misread of junk.
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
