import React from 'react';

let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-iconbtn{display:inline-flex;align-items:center;justify-content:center;
    border:var(--border-1) solid transparent;border-radius:var(--radius-md);
    background:transparent;color:var(--text-muted);cursor:pointer;
    transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out),
               border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast) var(--ease-out);}
  .rl-iconbtn:hover:not([disabled]){background:var(--surface-sunken);color:var(--text-strong);}
  .rl-iconbtn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-ring);}
  .rl-iconbtn:active:not([disabled]){transform:translateY(1px);}
  .rl-iconbtn[disabled]{opacity:.45;cursor:not-allowed;}
  .rl-iconbtn--sm{width:28px;height:28px;}
  .rl-iconbtn--md{width:36px;height:36px;}
  .rl-iconbtn--lg{width:44px;height:44px;}
  .rl-iconbtn--bordered{border-color:var(--border-default);background:var(--surface-card);}
  .rl-iconbtn--bordered:hover:not([disabled]){border-color:var(--border-strong);}
  .rl-iconbtn--active{background:var(--accent-soft);color:var(--text-accent);}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'iconbutton');
  el.textContent = css;
  document.head.appendChild(el);
}

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
  useStyles();
  const cls = `rl-iconbtn rl-iconbtn--${size}${bordered ? ' rl-iconbtn--bordered' : ''}${active ? ' rl-iconbtn--active' : ''} ${className}`.trim();
  return (
    <button type="button" className={cls} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
