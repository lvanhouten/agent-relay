import React from 'react';

let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-switch{display:inline-flex;align-items:center;gap:var(--space-3);cursor:pointer;
    font-family:var(--font-sans);font-size:var(--text-base);color:var(--text-body);}
  .rl-switch input{position:absolute;opacity:0;width:0;height:0;}
  .rl-switch__track{position:relative;flex-shrink:0;width:38px;height:22px;border-radius:var(--radius-full);
    background:var(--border-default);transition:background var(--dur-base) var(--ease-out);}
  .rl-switch__thumb{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;
    background:#fff;box-shadow:var(--shadow-sm);
    transition:transform var(--dur-base) var(--ease-snap);}
  .rl-switch input:checked + .rl-switch__track{background:var(--accent);}
  .rl-switch input:checked + .rl-switch__track .rl-switch__thumb{transform:translateX(16px);}
  .rl-switch input:focus-visible + .rl-switch__track{box-shadow:0 0 0 3px var(--accent-ring);}
  .rl-switch--disabled{opacity:.5;cursor:not-allowed;}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'switch');
  el.textContent = css;
  document.head.appendChild(el);
}

/** Switch — binary toggle for settings (theme, auto-reconnect, read-only). */
export function Switch({
  checked,
  defaultChecked,
  onChange,
  disabled = false,
  label,
  id,
  className = '',
  ...rest
}) {
  useStyles();
  const autoId = React.useId();
  const fieldId = id || autoId;
  return (
    <label className={`rl-switch${disabled ? ' rl-switch--disabled' : ''} ${className}`.trim()} htmlFor={fieldId}>
      <input
        id={fieldId}
        type="checkbox"
        role="switch"
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={onChange}
        disabled={disabled}
        {...rest}
      />
      <span className="rl-switch__track"><span className="rl-switch__thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  );
}
