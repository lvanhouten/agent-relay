import React from 'react';
import { Toast } from '@shared/Toast.jsx';
import { useToast } from '../core/useToast.tsx';
import styles from './ToastHost.module.scss';

// The transient-notification surface, mounted once per shell. A thin presenter
// over the toast queue: it renders the DS Toast for each queued entry and wires
// dismissal — all enqueue/coalesce/cap logic lives in core (toastQueue.ts).
// placement: 'corner' (desktop, bottom-right) or 'bottom' (mobile, full-width).
export function ToastHost({ placement = 'corner' }) {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;
  const cls = `${styles.host} ${placement === 'bottom' ? styles.bottom : styles.corner}`;
  return (
    <div className={cls} role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <Toast
          key={t.id}
          severity={t.severity}
          duration={t.sticky ? 0 : t.duration}
          onDismiss={() => dismiss(t.id)}
          action={
            t.action
              ? { label: t.action.label, onClick: () => { t.action.onAct(); dismiss(t.id); } }
              : undefined
          }
        >
          {t.message}
        </Toast>
      ))}
    </div>
  );
}
