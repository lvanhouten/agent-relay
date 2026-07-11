import React from 'react';

// Tracks the actual browser fullscreen state, not just the toggling button —
// fullscreen can also be left via Esc or the browser's own UI, which fires
// fullscreenchange but never calls back through a click handler.
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = React.useState(() => !!document.fullscreenElement);

  React.useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  };

  return { isFullscreen, toggleFullscreen };
}
