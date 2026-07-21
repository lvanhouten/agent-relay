import React from 'react';

let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-field{display:flex;flex-direction:column;gap:var(--space-2);}
  .rl-field__label{font-family:var(--font-mono);font-size:var(--text-2xs);
    font-weight:var(--weight-medium);letter-spacing:var(--tracking-label);
    text-transform:uppercase;color:var(--text-muted);}
  .rl-input-wrap{display:flex;align-items:center;gap:var(--space-2);
    background:var(--surface-card);border:var(--border-1) solid var(--border-default);
    border-radius:var(--radius-md);padding:0 var(--space-3);
    transition:border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast) var(--ease-out);}
  .rl-input-wrap--sm{height:var(--control-h-sm);}
  .rl-input-wrap--md{height:var(--control-h-md);}
  .rl-input-wrap--lg{height:var(--control-h-lg);}
  .rl-input-wrap:focus-within{border-color:var(--border-accent);box-shadow:0 0 0 3px var(--accent-ring);}
  .rl-input-wrap--error{border-color:var(--danger);}
  .rl-input-wrap--error:focus-within{box-shadow:0 0 0 3px var(--danger-soft);}
  .rl-input-wrap--mono .rl-input{font-family:var(--font-mono);}
  .rl-input{flex:1;min-width:0;border:none;background:transparent;outline:none;
    font-family:var(--font-sans);font-size:var(--text-base);color:var(--text-strong);
    height:100%;padding:0;}
  .rl-input::placeholder{color:var(--text-faint);}
  .rl-input-affix{display:inline-flex;align-items:center;color:var(--text-faint);flex-shrink:0;}
  .rl-field__hint{font-size:var(--text-xs);color:var(--text-muted);}
  .rl-field__hint--error{color:var(--danger);}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'input');
  el.textContent = css;
  document.head.appendChild(el);
}

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
  useStyles();
  const autoId = React.useId();
  const fieldId = id || autoId;
  const wrapCls = `rl-input-wrap rl-input-wrap--${size}${error ? ' rl-input-wrap--error' : ''}${mono ? ' rl-input-wrap--mono' : ''}`;
  return (
    <div className={`rl-field ${className}`.trim()}>
      {label && <label className="rl-field__label" htmlFor={fieldId}>{label}</label>}
      <div className={wrapCls}>
        {prefix && <span className="rl-input-affix">{prefix}</span>}
        <input id={fieldId} className="rl-input" aria-invalid={!!error} {...rest} />
        {suffix && <span className="rl-input-affix">{suffix}</span>}
      </div>
      {error
        ? <span className="rl-field__hint rl-field__hint--error">{error}</span>
        : hint && <span className="rl-field__hint">{hint}</span>}
    </div>
  );
}
