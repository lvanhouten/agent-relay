import React from 'react';

let _injected = false;
function useRelayButtonStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-btn{
    display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);
    font-family:var(--font-sans);font-weight:var(--weight-medium);
    border:var(--border-1) solid transparent;border-radius:var(--radius-md);
    cursor:pointer;white-space:nowrap;text-decoration:none;
    transition:background var(--dur-fast) var(--ease-out),
               border-color var(--dur-fast) var(--ease-out),
               color var(--dur-fast) var(--ease-out),
               box-shadow var(--dur-fast) var(--ease-out),
               transform var(--dur-fast) var(--ease-out);
  }
  .rl-btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-ring);}
  .rl-btn:active{transform:translateY(1px);}
  .rl-btn[disabled],.rl-btn[aria-disabled="true"]{opacity:.5;cursor:not-allowed;transform:none;}

  /* sizes */
  .rl-btn--sm{height:var(--control-h-sm);padding:0 var(--space-3);font-size:var(--text-sm);}
  .rl-btn--md{height:var(--control-h-md);padding:0 var(--space-4);font-size:var(--text-base);}
  .rl-btn--lg{height:var(--control-h-lg);padding:0 var(--space-5);font-size:var(--text-md);}

  /* variants */
  .rl-btn--primary{background:var(--accent);color:var(--text-on-accent);}
  .rl-btn--primary:hover:not([disabled]){background:var(--accent-hover);}
  .rl-btn--primary:active:not([disabled]){background:var(--accent-active);}

  .rl-btn--secondary{background:var(--surface-card);color:var(--text-strong);border-color:var(--border-default);}
  .rl-btn--secondary:hover:not([disabled]){background:var(--surface-sunken);border-color:var(--border-strong);}

  .rl-btn--ghost{background:transparent;color:var(--text-body);}
  .rl-btn--ghost:hover:not([disabled]){background:var(--surface-sunken);color:var(--text-strong);}

  .rl-btn--danger{background:var(--danger);color:#fff;}
  .rl-btn--danger:hover:not([disabled]){filter:brightness(0.93);}

  .rl-btn__spinner{width:14px;height:14px;border-radius:50%;
    border:2px solid currentColor;border-right-color:transparent;
    animation:rl-btn-spin .6s linear infinite;}
  @keyframes rl-btn-spin{to{transform:rotate(360deg);}}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'button');
  el.textContent = css;
  document.head.appendChild(el);
}

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
  useRelayButtonStyles();
  const cls = `rl-btn rl-btn--${variant} rl-btn--${size}${fullWidth ? ' rl-btn--block' : ''} ${className}`.trim();
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || loading}
      style={fullWidth ? { width: '100%' } : undefined}
      {...rest}
    >
      {loading && <span className="rl-btn__spinner" aria-hidden="true" />}
      {!loading && leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
}
