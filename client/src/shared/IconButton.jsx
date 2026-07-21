import React from 'react';
import styles from './IconButton.module.scss';

/** IconButton — square, icon-only control for toolbars and dense UI. */
export function IconButton({
  size = 'md',
  bordered = false,
  active = false,
  label,
  className = '',
  children,
  ...rest
}) {
  const cls = [
    styles['rl-iconbtn'],
    styles[`rl-iconbtn--${size}`],
    bordered && styles['rl-iconbtn--bordered'],
    active && styles['rl-iconbtn--active'],
    className,
  ].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
