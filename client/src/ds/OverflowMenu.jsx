import React from 'react';
import { MoreVertical } from 'lucide-react';
import { IconButton } from './IconButton.jsx';

let _injected = false;
function useStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const css = `
  .rl-overflow{position:relative;flex-shrink:0;}
  .rl-overflow__panel{position:absolute;top:calc(100% + 6px);right:0;min-width:200px;
    background:var(--surface-card);border:var(--border-1) solid var(--border-default);
    border-radius:var(--radius-md);box-shadow:0 8px 24px rgba(0,0,0,.28);
    padding:4px;z-index:50;display:flex;flex-direction:column;gap:2px;}
  .rl-overflow__item{display:flex;align-items:center;gap:var(--space-2);
    padding:8px 10px;border:none;background:transparent;border-radius:var(--radius-sm);
    color:var(--text-body);font-family:inherit;font-size:var(--text-sm);
    cursor:pointer;text-align:left;width:100%;}
  .rl-overflow__item:hover{background:var(--surface-sunken);color:var(--text-strong);}
  .rl-overflow__item--active{color:var(--text-accent);}
  `;
  const el = document.createElement('style');
  el.setAttribute('data-relay', 'overflowmenu');
  el.textContent = css;
  document.head.appendChild(el);
}

/**
 * OverflowMenu — a "..." trigger revealing actions that didn't fit inline.
 * items: [{ key, label, icon, active, onClick }]
 */
export function OverflowMenu({ items, label = 'More actions' }) {
  useStyles();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!items || items.length === 0) return null;

  return (
    <div className="rl-overflow" ref={rootRef}>
      <IconButton label={label} active={open} onClick={() => setOpen((v) => !v)}>
        <MoreVertical size={15} />
      </IconButton>
      {open && (
        <div className="rl-overflow__panel" role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              title={item.label}
              className={`rl-overflow__item${item.active ? ' rl-overflow__item--active' : ''}`}
              onClick={() => { item.onClick(); setOpen(false); }}
            >
              {item.icon}
              <span>{item.menuLabel ?? item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
