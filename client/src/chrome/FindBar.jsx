import React from 'react';
import { IconButton } from '@ds/IconButton.jsx';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { searchReadout } from '../core/searchReadout.ts';

// Terminal find bar — the one piece of chrome shared across shells (every
// other screen affordance is deliberately per-shell). Owns its own input
// state and keyboard handling; talks outward only through callbacks + the
// `results` prop, never touching the terminal view directly, so each shell
// wires it to its own view ref.
//
// Props:
//   results: SearchResults (core/types.ts) — resultIndex/resultCount for the readout
//   onQuery(term: string): void — fired as the term changes; empty term = caller clears
//   onNext(term: string): void
//   onPrev(term: string): void
//   onClose(): void
export function FindBar({ results, onQuery, onNext, onPrev, onClose }) {
  const [term, setTerm] = React.useState('');
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const changeTerm = (value) => {
    setTerm(value);
    onQuery(value);
  };

  const handleKeyDown = (e) => {
    // A CJK/predictive-keyboard candidate confirmation arrives as Enter
    // mid-composition — it must not run the search early.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? onPrev(term) : onNext(term); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  const matchReadout = searchReadout(term, results);

  return (
    <div style={{
      flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
      padding: 'var(--space-2) var(--space-4)',
      background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)',
    }}>
      <Search size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
      <input
        ref={inputRef}
        value={term}
        onChange={(e) => changeTerm(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in output…"
        style={{
          flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none',
          fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-strong)',
        }}
      />
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)',
        color: 'var(--text-faint)', minWidth: 40, textAlign: 'right',
      }}>
        {matchReadout}
      </span>
      <IconButton size="sm" label="Previous match" onClick={() => onPrev(term)}>
        <ChevronUp size={15} />
      </IconButton>
      <IconButton size="sm" label="Next match" onClick={() => onNext(term)}>
        <ChevronDown size={15} />
      </IconButton>
      <IconButton size="sm" label="Close search" onClick={onClose}>
        <X size={15} />
      </IconButton>
    </div>
  );
}
