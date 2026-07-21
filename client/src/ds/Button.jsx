import React from 'react';
import styles from './Button.module.scss';

/**
 * Button — the primary action control across agent-relay.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  leadingIcon = null,
  trailingIcon = null,
  loading = false,
  disabled = false,
  fullWidth = false,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const cls = [styles['rl-btn'], styles[`rl-btn--${variant}`], styles[`rl-btn--${size}`], className]
    .filter(Boolean).join(' ');
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || loading}
      style={fullWidth ? { width: '100%' } : undefined}
      {...rest}
    >
      {loading && <span className={styles['rl-btn__spinner']} aria-hidden="true" />}
      {!loading && leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
}
