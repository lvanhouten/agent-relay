// Pinned directory paths the create dialog's browse picker can jump to in one
// tap. Lighter than a spawn template: just a starting folder, not a whole
// {name, cwd, command} shape. Array ops are pure and unit-tested; load() must
// never throw on a corrupt/hand-edited store inside the picker's mount.
//
// Phase 2 moves this server-side (alongside templates) so favorites follow
// the operator across devices.

const KEY = 'ar-fav-folders';

// Cap so the favorites strip can't grow unbounded and crowd out the folder list.
export const MAX_FAVORITES = 20;

// Compare/dedupe form: drop a trailing separator so "C:\foo" and "C:\foo\" are
// one favorite. Casing/separators are left as the server returned them —
// favorited and compared verbatim, never normalized twice.
function canonical(path: string): string {
  return path.trim().replace(/[\\/]+$/, '');
}

export function isFavorite(list: string[], path: string): boolean {
  const c = canonical(path);
  return list.some((f) => canonical(f) === c);
}

// Append if new (stable order), no-op if already pinned. Over the cap, the oldest
// entry drops from the front. The path is stored trimmed but otherwise verbatim.
export function addFavorite(list: string[], path: string): string[] {
  const clean = path.trim();
  if (!clean || isFavorite(list, clean)) return list;
  const next = [...list, clean];
  return next.length > MAX_FAVORITES ? next.slice(next.length - MAX_FAVORITES) : next;
}

export function removeFavorite(list: string[], path: string): string[] {
  const c = canonical(path);
  return list.filter((f) => canonical(f) !== c);
}

// Parse a raw localStorage string into a clean list: only non-empty strings survive,
// deduped by canonical form (first occurrence wins), capped. Returns [] for null,
// unparseable JSON, a non-array, or an array with no valid entries.
export function parseFavorites(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const v of parsed) {
    if (typeof v !== 'string') continue;
    const clean = v.trim();
    if (clean && !isFavorite(out, clean)) out.push(clean);
  }
  return out.length > MAX_FAVORITES ? out.slice(out.length - MAX_FAVORITES) : out;
}

export function serializeFavorites(list: string[]): string {
  return JSON.stringify(list);
}

// --- localStorage wrappers (browser I/O over the pure ops above) ---

export function loadFavorites(): string[] {
  try { return parseFavorites(localStorage.getItem(KEY)); } catch { return []; }
}

// Returns whether the write persisted; a quota/private-mode failure is non-fatal
// but the caller may want to know (same contract as saveTemplates).
export function saveFavorites(list: string[]): boolean {
  try { localStorage.setItem(KEY, serializeFavorites(list)); return true; }
  catch { return false; }
}
