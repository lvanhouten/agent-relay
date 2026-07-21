import React from 'react';
import { IconButton } from '@shared/IconButton.jsx';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { searchReadout } from '../core/searchReadout.ts';
import styles from './FindBar.module.scss';

// Chrome shared across both shells; talks outward only through callbacks and
// `results`, never touching the terminal view directly — each shell wires its own ref.
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
    // IME candidate confirmation arrives as Enter mid-composition; must not run search early.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? onPrev(term) : onNext(term); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  const matchReadout = searchReadout(term, results);

  return (
    <div className={styles.bar}>
      <Search size={14} className={styles.icon} />
      <input
        ref={inputRef}
        value={term}
        onChange={(e) => changeTerm(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in output…"
        className={styles.input}
      />
      <span className={styles.count}>
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
