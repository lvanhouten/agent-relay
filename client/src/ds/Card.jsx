import React from 'react';
import styles from './Card.module.scss';

/** Card — surface container for sessions, panels and grouped content. */
export function Card({
  padding = 'md',
  flat = false,
  interactive = false,
  selected = false,
  as: Tag = 'div',
  className = '',
  children,
  ...rest
}) {
  const cls = [
    styles['rl-card'],
    styles[`rl-card--pad-${padding}`],
    flat && styles['rl-card--flat'],
    interactive && styles['rl-card--interactive'],
    selected && styles['rl-card--selected'],
    className,
  ].filter(Boolean).join(' ');
  return <Tag className={cls} {...rest}>{children}</Tag>;
}
