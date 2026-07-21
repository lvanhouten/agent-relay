// The find bar's "n/m" match readout. SearchAddon's resultCount is -1 until
// decorations are actually computed — that sentinel renders as NOTHING, while
// a genuine 0 with a live query renders "0/0". resultIndex is 0-based, hence +1.
import type { SearchResults } from './types.ts';

export function searchReadout(term: string, results: SearchResults): string {
  if (results.resultCount > 0) return `${results.resultIndex + 1}/${results.resultCount}`;
  if (term && results.resultCount === 0) return '0/0';
  return '';
}
