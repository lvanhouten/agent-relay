import React from 'react';
import styles from './Input.module.scss';

/** Input — single-line text field with label, affixes, and error/hint states. */
export function Input({
  label,
  size = 'md',
  prefix = null,
  suffix = null,
  error = '',
  hint = '',
  mono = false,
  id,
  className = '',
  ...rest
}) {
  const autoId = React.useId();
  const fieldId = id || autoId;
  const wrapCls = [
    styles['rl-input-wrap'],
    styles[`rl-input-wrap--${size}`],
    error && styles['rl-input-wrap--error'],
    mono && styles['rl-input-wrap--mono'],
  ].filter(Boolean).join(' ');
  return (
    <div className={[styles['rl-field'], className].filter(Boolean).join(' ')}>
      {label && <label className={styles['rl-field__label']} htmlFor={fieldId}>{label}</label>}
      <div className={wrapCls}>
        {prefix && <span className={styles['rl-input-affix']}>{prefix}</span>}
        <input id={fieldId} className={styles['rl-input']} aria-invalid={!!error} {...rest} />
        {suffix && <span className={styles['rl-input-affix']}>{suffix}</span>}
      </div>
      {error
        ? <span className={[styles['rl-field__hint'], styles['rl-field__hint--error']].join(' ')}>{error}</span>
        : hint && <span className={styles['rl-field__hint']}>{hint}</span>}
    </div>
  );
}
