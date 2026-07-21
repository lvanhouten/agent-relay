import React from 'react';

let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-toast{display:flex;align-items:flex-start;gap:var(--space-3);
    width:100%;padding:var(--space-3) var(--space-3) var(--space-3) var(--space-4);
    background:var(--surface-raised);border:var(--border-1) solid var(--border-subtle);
    border-left-width:3px;border-radius:var(--radius-md);box-shadow:var(--shadow-lg);
    font-family:var(--font-sans);animation:rl-toast-in var(--dur-base) var(--ease-out);}
  @keyframes rl-toast-in{from{opacity:0;transform:translateY(8px) scale(.98);}to{opacity:1;transform:none;}}
  @media (prefers-reduced-motion: reduce){.rl-toast{animation:none;}}
  .rl-toast--error{border-left-color:var(--danger);}
  .rl-toast--warn{border-left-color:var(--warning);}
  .rl-toast--success{border-left-color:var(--success);}
  .rl-toast--info{border-left-color:var(--info);}
  .rl-toast__body{flex:1;min-width:0;font-size:var(--text-sm);line-height:var(--leading-snug);
    color:var(--text-body);word-break:break-word;}
  .rl-toast__action{flex-shrink:0;align-self:center;cursor:pointer;
    font-family:var(--font-mono);font-size:var(--text-2xs);font-weight:var(--weight-medium);
    letter-spacing:var(--tracking-wide);text-transform:uppercase;
    padding:var(--space-1) var(--space-2);border-radius:var(--radius-sm);
    background:transparent;border:var(--border-1) solid var(--border-default);color:var(--text-accent);
    transition:border-color var(--dur-fast) var(--ease-out),background var(--dur-fast) var(--ease-out);}
  .rl-toast__action:hover{border-color:var(--border-accent);background:var(--accent-soft);}
  .rl-toast__action:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-ring);}
  .rl-toast__close{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;
    width:22px;height:22px;margin:-2px -2px 0 0;padding:0;cursor:pointer;
    background:transparent;border:none;border-radius:var(--radius-sm);
    color:var(--text-faint);font-size:16px;line-height:1;
    transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out);}
  .rl-toast__close:hover{background:var(--surface-sunken);color:var(--text-strong);}
  .rl-toast__close:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent-ring);}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'toast');
  el.textContent = css;
  document.head.appendChild(el);
}

/**
 * Toast — transient in-window notification. Owns its own auto-dismiss timer
 * (paused while hovered or keyboard-focused so it can't vanish mid-read); pass
 * duration={0} for a sticky toast the caller clears explicitly. severity keys
 * the accent bar and the ARIA politeness (error → assertive alert).
 */
export function Toast({
  severity = 'info',
  duration = 5000,
  onDismiss,
  action,
  className = '',
  children,
  ...rest
}) {
  useStyles();
  const timer = React.useRef();
  const clear = React.useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
  }, []);
  const arm = React.useCallback(() => {
    clear();
    if (duration > 0 && onDismiss) timer.current = setTimeout(onDismiss, duration);
  }, [clear, duration, onDismiss]);
  React.useEffect(() => { arm(); return clear; }, [arm, clear]);

  return (
    <div
      className={`rl-toast rl-toast--${severity} ${className}`.trim()}
      role={severity === 'error' ? 'alert' : 'status'}
      onMouseEnter={clear}
      onMouseLeave={arm}
      onFocus={clear}
      onBlur={arm}
      {...rest}
    >
      <div className="rl-toast__body">{children}</div>
      {action && (
        <button type="button" className="rl-toast__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button type="button" className="rl-toast__close" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}
