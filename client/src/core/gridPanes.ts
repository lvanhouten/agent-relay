// Pure state transitions for the desktop spectator grid. The grid is
// an ordered set of session ids rendered as panes; one is "focused"
// (interactive), the rest are spectators. Kept pure and here so the transitions
// are unit-tested directly rather than only through DesktopWorkspace.

// Add a pane, preserving order and idempotent on a re-inject.
export function injectPane(gridIds: string[], id: string): string[] {
  return gridIds.includes(id) ? gridIds : [...gridIds, id];
}

// Drop a pane. Safe when the id isn't present.
export function removePane(gridIds: string[], id: string): string[] {
  return gridIds.filter((x) => x !== id);
}

// Keep only panes whose session is still around (a watched line that exits or is
// evicted from the board ring must not linger as a dead pane).
export function prunePanes(gridIds: string[], liveIds: Set<string>): string[] {
  return gridIds.filter((id) => liveIds.has(id));
}

// The focused (interactive) pane: the selected id when it's in the grid,
// otherwise the first pane. null when the grid is empty.
export function focusedPane(gridIds: string[], selectedId: string | null): string | null {
  if (gridIds.length === 0) return null;
  return selectedId && gridIds.includes(selectedId) ? selectedId : gridIds[0];
}

// Arrange pane ids into balanced rows for the resizable grid: roughly square,
// filling left-to-right then top-to-bottom. 1->[[a]], 2->[[a,b]], 3->[[a,b],[c]],
// 4->[[a,b],[c,d]], 5->[[a,b,c],[d,e]], 6->[[a,b,c],[d,e,f]].
export function paneRows(ids: string[]): string[][] {
  const n = ids.length;
  if (n === 0) return [];
  const cols = Math.ceil(Math.sqrt(n));
  const rows: string[][] = [];
  for (let i = 0; i < n; i += cols) rows.push(ids.slice(i, i + cols));
  return rows;
}
