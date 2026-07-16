import React from 'react';

// Every header action button is the same fixed square (see IconButton's --md
// size) plus the row's own gap, so "how many fit" is a single division - no
// per-element measurement needed.
export const ACTION_SLOT_PX = 36 + 8;

// How many trailing action buttons fit in the space CSS flex-grow actually
// hands the actions row: the row has flex:'1 1 0' and minWidth:0, with a
// fixed-width slot always reserved for the "…" trigger, so its resolved
// clientWidth already IS "room for buttons" - no inference or subtraction
// needed, and it's correct in both directions (shrinking AND growing back)
// since flex-grow, not the row's own content, drives its size. This avoids
// the header's scrollWidth, which only reflects true content width while
// overflowing - once things fit, scrollWidth just collapses to clientWidth
// and the signal is lost.
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
