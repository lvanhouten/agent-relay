import React from 'react';

let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-status{display:inline-flex;align-items:center;gap:var(--space-2);
    font-family:var(--font-mono);font-size:var(--text-2xs);
    letter-spacing:var(--tracking-label);text-transform:uppercase;
    font-weight:var(--weight-medium);color:var(--text-muted);}
  .rl-status__dot{position:relative;display:inline-block;border-radius:50%;flex-shrink:0;}
  .rl-status__dot--sm{width:7px;height:7px;}
  .rl-status__dot--md{width:9px;height:9px;}
  .rl-status--online .rl-status__dot{background:var(--status-online);}
  .rl-status--idle   .rl-status__dot{background:var(--status-idle);}
  .rl-status--offline .rl-status__dot{background:var(--status-offline);}
  .rl-status--error  .rl-status__dot{background:var(--status-error);}
  .rl-status--attention .rl-status__dot{background:var(--status-attention);}
  .rl-status--online  { color:var(--text-accent); }
  .rl-status__dot--pulse::after{content:"";position:absolute;inset:0;border-radius:50%;
    background:inherit;animation:rl-pulse 1.8s var(--ease-out) infinite;}
  @keyframes rl-pulse{0%{transform:scale(1);opacity:.6;}70%{transform:scale(2.6);opacity:0;}100%{opacity:0;}}
  @media (prefers-reduced-motion: reduce){.rl-status__dot--pulse::after{animation:none;}}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'statusdot');
  el.textContent = css;
  document.head.appendChild(el);
}

const DEFAULT_LABELS = { online: 'online', idle: 'idle', offline: 'offline', error: 'error', attention: 'needs input' };

/** StatusDot — connection state indicator for sessions and the relay host. */
export function StatusDot({
  status = 'offline',
  size = 'md',
  pulse,
  label,
  showLabel = true,
  className = '',
  ...rest
}) {
  useStyles();
  const doPulse = pulse ?? status === 'online';
  const text = label ?? DEFAULT_LABELS[status] ?? status;
  return (
    <span className={`rl-status rl-status--${status} ${className}`.trim()} {...rest}>
      <span className={`rl-status__dot rl-status__dot--${size}${doPulse ? ' rl-status__dot--pulse' : ''}`} />
      {showLabel && <span>{text}</span>}
    </span>
  );
}
