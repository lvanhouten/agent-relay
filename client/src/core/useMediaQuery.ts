import React from 'react';

// Live media-query state — unlike a mount-time-only matchMedia().matches read
// (see TerminalScreen's prefersComposer), this tracks viewport/feature
// changes for values that should respond to resize, not just device class.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  ));

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
