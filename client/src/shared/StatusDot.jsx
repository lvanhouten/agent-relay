import React from 'react';
import styles from './StatusDot.module.scss';

const DEFAULT_LABELS = { online: 'online', idle: 'idle', offline: 'offline', error: 'error', attention: 'needs input', done: 'turn done' };

/** StatusDot — connection state indicator for sessions and the relay host. */
export function StatusDot({
  status = 'offline',
  size = 'md',
  pulse,
  label,
  showLabel = true,
  className = '',
  ...rest
}) {
  const doPulse = pulse ?? status === 'online';
  const text = label ?? DEFAULT_LABELS[status] ?? status;
  const rootCls = [styles['rl-status'], styles[`rl-status--${status}`], className].filter(Boolean).join(' ');
  const dotCls = [
    styles['rl-status__dot'],
    styles[`rl-status__dot--${size}`],
    doPulse && styles['rl-status__dot--pulse'],
  ].filter(Boolean).join(' ');
  return (
    <span className={rootCls} {...rest}>
      <span className={dotCls} />
      {showLabel && <span>{text}</span>}
    </span>
  );
}
