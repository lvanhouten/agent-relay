import React from 'react';

let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-card{background:var(--surface-card);border:var(--border-1) solid var(--border-subtle);
    border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);
    transition:border-color var(--dur-base) var(--ease-out),
               box-shadow var(--dur-base) var(--ease-out),
               transform var(--dur-base) var(--ease-out);}
  .rl-card--pad-sm{padding:var(--space-4);}
  .rl-card--pad-md{padding:var(--space-5);}
  .rl-card--pad-lg{padding:var(--space-6);}
  .rl-card--flat{box-shadow:none;}
  .rl-card--interactive{cursor:pointer;}
  .rl-card--interactive:hover{border-color:var(--border-accent);box-shadow:var(--shadow-md);transform:translateY(-2px);}
  .rl-card--interactive:active{transform:translateY(0);}
  .rl-card--selected{border-color:var(--border-accent);box-shadow:var(--glow-accent);}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'card');
  el.textContent = css;
  document.head.appendChild(el);
}

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
  useStyles();
  const cls = `rl-card rl-card--pad-${padding}${flat ? ' rl-card--flat' : ''}${interactive ? ' rl-card--interactive' : ''}${selected ? ' rl-card--selected' : ''} ${className}`.trim();
  return <Tag className={cls} {...rest}>{children}</Tag>;
}
