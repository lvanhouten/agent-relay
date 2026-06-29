import React from 'react';

let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-kbd{display:inline-flex;align-items:center;justify-content:center;
    font-family:var(--font-mono);font-size:var(--text-2xs);font-weight:var(--weight-medium);
    color:var(--text-body);background:var(--surface-card);
    border:var(--border-1) solid var(--border-default);
    border-bottom-width:2px;border-radius:var(--radius-sm);
    min-width:20px;height:20px;padding:0 5px;line-height:1;}
  .rl-kbd-group{display:inline-flex;align-items:center;gap:4px;
    font-family:var(--font-mono);font-size:var(--text-2xs);color:var(--text-faint);}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'kbd');
  el.textContent = css;
  document.head.appendChild(el);
}

/** Kbd — renders a keyboard key, or a combo when given an array of keys. */
export function Kbd({ keys, className = '', children, ...rest }) {
  useStyles();
  if (Array.isArray(keys)) {
    return (
      <span className={`rl-kbd-group ${className}`.trim()} {...rest}>
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span>+</span>}
            <kbd className="rl-kbd">{k}</kbd>
          </React.Fragment>
        ))}
      </span>
    );
  }
  return <kbd className={`rl-kbd ${className}`.trim()} {...rest}>{children}</kbd>;
}
