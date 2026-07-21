import React from 'react';
import styles from './Kbd.module.scss';

/** Kbd — renders a keyboard key, or a combo when given an array of keys. */
export function Kbd({ keys, className = '', children, ...rest }) {
  if (Array.isArray(keys)) {
    return (
      <span className={[styles['rl-kbd-group'], className].filter(Boolean).join(' ')} {...rest}>
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span>+</span>}
            <kbd className={styles['rl-kbd']}>{k}</kbd>
          </React.Fragment>
        ))}
      </span>
    );
  }
  return <kbd className={[styles['rl-kbd'], className].filter(Boolean).join(' ')} {...rest}>{children}</kbd>;
}
