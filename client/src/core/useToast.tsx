import React from 'react';
import {
  enqueue,
  dismiss as qDismiss,
  dismissKey as qDismissKey,
  DEFAULT_DURATION,
} from './toastQueue.ts';
import type { Toast, ToastInput, Notifier } from './toastQueue.ts';

// The React seam over toastQueue.ts: holds the visible list, exposes an
// imperative notify()/dismiss(), renders nothing itself — the host
// (chrome/ToastHost) is a separate consumer, so this core module never
// imports app UI. List-mutation rules live in the pure module; this file owns
// only id assignment and React wiring.

// notify/dismiss/dismissKey are stable, so `notifier` keeps a stable identity —
// useSessions can safely list it in its effect deps.
export interface ToastApi extends Notifier {
  toasts: Toast[];
  notifier: Notifier;
}

const ToastContext = React.createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const seq = React.useRef(0);

  const notify = React.useCallback((input: ToastInput): string => {
    const id = `t${seq.current++}`;
    const toast: Toast = {
      id,
      key: input.key,
      severity: input.severity ?? 'info',
      message: input.message,
      sticky: input.sticky ?? false,
      duration: input.duration ?? DEFAULT_DURATION,
      action: input.action,
    };
    setToasts((list) => enqueue(list, toast));
    // A keyed coalesce keeps the surviving toast's original id, so callers
    // clearing a keyed toast use dismissKey, not this return value.
    return id;
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setToasts((list) => qDismiss(list, id));
  }, []);

  const dismissKey = React.useCallback((key: string) => {
    setToasts((list) => qDismissKey(list, key));
  }, []);

  // Stable across renders (notify/dismiss/dismissKey never change), so passing
  // it into useSessions doesn't churn that hook's poll effect.
  const notifier = React.useMemo<Notifier>(
    () => ({ notify, dismiss, dismissKey }),
    [notify, dismiss, dismissKey],
  );

  const api = React.useMemo<ToastApi>(
    () => ({ toasts, notifier, notify, dismiss, dismissKey }),
    [toasts, notifier, notify, dismiss, dismissKey],
  );

  return <ToastContext.Provider value={api}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
