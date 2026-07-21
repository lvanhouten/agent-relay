import React from 'react';

// Every header action button is the same fixed square (IconButton's --md size)
// plus the row's gap, so "how many fit" is a single division.
export const ACTION_SLOT_PX = 36 + 8;

// Trailing action buttons that fit the actions row's flex-grow space: the row
// is flex:'1 1 0'/minWidth:0 with a fixed "…" trigger slot always reserved, so
// its clientWidth already IS "room for buttons" — correct both shrinking and
// growing back, since flex-grow drives its size, not its content. Avoids the
// header's scrollWidth, which collapses to clientWidth (losing the signal)
// once things fit.
export function useVisibleActionCount(actionsRowRef: React.RefObject<HTMLElement>, totalActions: number) {
  const [visibleCount, setVisibleCount] = React.useState(totalActions);

  React.useLayoutEffect(() => {
    const el = actionsRowRef.current;
    if (!el) return;
    const recompute = () => {
      const next = Math.max(0, Math.min(totalActions, Math.floor(el.clientWidth / ACTION_SLOT_PX)));
      setVisibleCount((prev) => (prev === next ? prev : next));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [actionsRowRef, totalActions]);

  return visibleCount;
}
