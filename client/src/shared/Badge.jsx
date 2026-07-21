import React from 'react';
import styles from './Badge.module.scss';

/** Badge — compact mono label for counts, statuses, shells, and tags. */
export function Badge({ variant = 'neutral', className = '', children, ...rest }) {
  const cls = [styles['rl-badge'], styles[`rl-badge--${variant}`], className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
