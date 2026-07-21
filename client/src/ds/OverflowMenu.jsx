import React from 'react';
import { MoreVertical } from 'lucide-react';
import { IconButton } from './IconButton.jsx';
import styles from './OverflowMenu.module.scss';

/**
 * OverflowMenu — a "..." trigger revealing actions that didn't fit inline.
 * items: [{ key, label, icon, active, onClick }]
 */
export function OverflowMenu({ items, label = 'More actions' }) {
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
    <div className={styles['rl-overflow']} ref={rootRef}>
      <IconButton label={label} active={open} onClick={() => setOpen((v) => !v)}>
        <MoreVertical size={15} />
      </IconButton>
      {open && (
        <div className={styles['rl-overflow__panel']} role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              title={item.label}
              className={[styles['rl-overflow__item'], item.active && styles['rl-overflow__item--active']]
                .filter(Boolean).join(' ')}
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
