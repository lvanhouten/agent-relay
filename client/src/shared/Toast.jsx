import React from 'react';
import styles from './Toast.module.scss';

/**
 * Toast — transient in-window notification. Owns its own auto-dismiss timer
 * (paused while hovered or keyboard-focused so it can't vanish mid-read); pass
 * duration={0} for a sticky toast the caller clears explicitly. severity keys
 * the accent bar and the ARIA politeness (error → assertive alert).
 */
export function Toast({
  severity = 'info',
  duration = 5000,
  onDismiss,
  action,
  className = '',
  children,
  ...rest
}) {
  const timer = React.useRef();
  const clear = React.useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
  }, []);
  const arm = React.useCallback(() => {
    clear();
    if (duration > 0 && onDismiss) timer.current = setTimeout(onDismiss, duration);
  }, [clear, duration, onDismiss]);
  React.useEffect(() => { arm(); return clear; }, [arm, clear]);

  const cls = [styles['rl-toast'], styles[`rl-toast--${severity}`], className].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      role={severity === 'error' ? 'alert' : 'status'}
      onMouseEnter={clear}
      onMouseLeave={arm}
      onFocus={clear}
      onBlur={arm}
      {...rest}
    >
      <div className={styles['rl-toast__body']}>{children}</div>
      {action && (
        <button type="button" className={styles['rl-toast__action']} onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button type="button" className={styles['rl-toast__close']} aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}
