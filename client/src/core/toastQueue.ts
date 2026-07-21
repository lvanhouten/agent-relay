// The in-app toast queue's pure state math, extracted from the provider so the
// enqueue/coalesce/cap/dismiss rules are unit-tested directly rather than proven
// only through a component (no component-test harness exists — CLAUDE.md). No
// time and no id generation live here: auto-dismiss is the DS Toast component's
// own timer, and the provider assigns ids — this module only manipulates the
// list, so every function is referentially transparent.

export type ToastSeverity = 'error' | 'warn' | 'success' | 'info';

// An optional action button. The queue only carries it; the host wires the
// click to onAct (then dismisses). Held in-memory only, never serialized.
export interface ToastAction {
  label: string;
  onAct: () => void;
}

export interface Toast {
  id: string;
  // Coalesce key. A second enqueue with the same key updates the existing
  // toast in place (same slot, same id) instead of stacking — one
  // "relay unreachable", not one per 5s poll. Absent → always a new toast.
  key?: string;
  severity: ToastSeverity;
  message: string;
  // Sticky toasts never auto-dismiss and survive the visible cap; they are
  // cleared explicitly by key (relay-unreachable clears on the next good poll).
  sticky: boolean;
  // Auto-dismiss lifetime in ms for transient toasts; ignored when sticky.
  duration: number;
  action?: ToastAction;
}

// What a caller passes to notify(); the provider fills in id + defaults.
export interface ToastInput {
  message: string;
  severity?: ToastSeverity;
  key?: string;
  sticky?: boolean;
  duration?: number;
  action?: ToastAction;
}

// The imperative seam a pusher consumes (useSessions, the shells). ToastApi
// (useToast.tsx) is this plus the current list for the host to render.
export interface Notifier {
  notify: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  dismissKey: (key: string) => void;
}

export const MAX_VISIBLE = 3;
export const DEFAULT_DURATION = 5000;

// Drop oldest-first to fit the visible cap, but never evict a sticky toast for
// a burst of transient ones — a sticky relay-unreachable must outlast them.
// Only if every visible toast is sticky (never in practice) does the oldest go.
function trim(list: Toast[], max: number): Toast[] {
  if (list.length <= max) return list;
  const next = list.slice();
  while (next.length > max) {
    const i = next.findIndex((t) => !t.sticky);
    next.splice(i === -1 ? 0 : i, 1);
  }
  return next;
}

// Add a toast, or coalesce onto an existing same-key one (keeping its slot and
// id so the component doesn't remount and the sticky message updates in place).
export function enqueue(list: Toast[], toast: Toast, max = MAX_VISIBLE): Toast[] {
  if (toast.key) {
    const idx = list.findIndex((t) => t.key === toast.key);
    if (idx !== -1) {
      const next = list.slice();
      next[idx] = { ...toast, id: list[idx].id };
      return next;
    }
  }
  return trim([...list, toast], max);
}

// Identity-preserving on a miss: the poll loop calls dismissKey every 5s to
// clear the relay-unreachable toast, and returning the same array when nothing
// matched lets React bail out of the re-render instead of churning the host.
export function dismiss(list: Toast[], id: string): Toast[] {
  const next = list.filter((t) => t.id !== id);
  return next.length === list.length ? list : next;
}

export function dismissKey(list: Toast[], key: string): Toast[] {
  const next = list.filter((t) => t.key !== key);
  return next.length === list.length ? list : next;
}
