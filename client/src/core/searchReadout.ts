// The find bar's "n/m" match readout. Real derivation, not formatting fluff:
// SearchAddon reports resultCount -1 until it has actually computed decorations,
// and that "not computed yet" sentinel must render as NOTHING — while a genuine
// 0 with a live query renders "0/0" (searched, no matches). resultIndex is
// 0-based, hence the +1.
import type { SearchResults } from './types.ts';

export function searchReadout(term: string, results: SearchResults): string {
  if (results.resultCount > 0) return `${results.resultIndex + 1}/${results.resultCount}`;
  if (term && results.resultCount === 0) return '0/0';
  return '';
}
