import React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useSessionWS } from './useSessionWS.ts';
import { XTERM_THEMES } from './xtermThemes.ts';
import type { ConnStatus, TerminalViewMode } from './types.ts';

export interface TerminalViewProps {
  sessionId: string;
  theme: string;
  // 'interactive' (the default, and the only implemented mode): fit xterm to
  // the container and push the size to the board. 'spectator' (adopt the
  // reported PTY dims + CSS-scale, never send resize) is a declared contract
  // for the desktop shell — passing it today behaves as 'interactive'.
  mode?: TerminalViewMode;
  // Ctrl+D inside the terminal — detach without ending the session.
  onDetach?: () => void;
  // Fires whenever the WS connection status changes, incl. the initial
  // 'connecting'. For chrome (status dots) outside this component.
  onStatusChange?: (status: ConnStatus) => void;
}

export interface TerminalViewHandle {
  // Current xterm selection, for clipboard chrome outside the component.
  getSelection(): string;
}

// The terminal proper: owns the xterm instance, its themes, the mount dance
// (fit timing, font-load refit, padding-on-wrapper-not-mount-node), and the
// session WebSocket. Chrome — headers, footers, back buttons — stays in the
// consuming screen.
export const TerminalView = React.forwardRef<TerminalViewHandle, TerminalViewProps>(
  function TerminalView({ sessionId, theme, onDetach, onStatusChange }, handleRef) {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const termRef = React.useRef<Terminal | null>(null);

    // These refs exist to bridge the useSessionWS socket effect, which
    // intentionally excludes its callbacks from its dependency array (so a callback
    // identity change doesn't tear down and reconnect the WS). The stable callbacks
    // passed to the hook read through these refs; the xterm mount effect below fills
    // them in. Without the refs the hook would either reconnect on every render or
    // capture stale closures. See useSessionWS's exhaustive-deps opt-out.
    const onDataRef = React.useRef<((data: string) => void) | null>(null);
    const onExitRef = React.useRef<((code: number | null) => void) | null>(null);
    const refitRef = React.useRef<(() => void) | null>(null);
    const onDetachRef = React.useRef(onDetach);
    React.useEffect(() => { onDetachRef.current = onDetach; }, [onDetach]);

    const { connStatus, send, resize } = useSessionWS(sessionId, undefined, {
      onData: React.useCallback((data: string) => onDataRef.current?.(data), []),
      onExit: React.useCallback((code: number | null) => onExitRef.current?.(code), []),
      // On (re)connect the socket is finally OPEN, so push the fitted size to the
      // board — the mount-time fit fires before the WS opens and gets dropped. On a
      // reconnect, reset the terminal first so the board's scrollback replay repaints
      // current state instead of appending a duplicate below the stale buffer.
      onReady: React.useCallback((reconnected: boolean) => {
        if (reconnected) termRef.current?.reset();
        refitRef.current?.();
      }, []),
    });

    // Report status to the chrome outside. Bridged through a ref so a new
    // callback identity doesn't re-fire the effect with a stale status.
    const onStatusChangeRef = React.useRef(onStatusChange);
    React.useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);
    React.useEffect(() => { onStatusChangeRef.current?.(connStatus); }, [connStatus]);

    React.useImperativeHandle(handleRef, () => ({
      getSelection: () => termRef.current?.getSelection() ?? '',
    }), []);

    // Mount xterm once
    React.useEffect(() => {
      const term = new Terminal({
        theme: XTERM_THEMES[theme] ?? XTERM_THEMES.dark,
        fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
        fontSize: 13,
        lineHeight: 1.5,
        cursorBlink: true,
        allowProposedApi: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current!);
      termRef.current = term;

      let disposed = false;
      let rafId = 0;
      const safeFit = () => {
        if (disposed || !containerRef.current) return;
        fit.fit();
        resize(term.cols, term.rows);
      };
      refitRef.current = safeFit;
      // Fit after layout settles, then again once the monospace font has loaded —
      // font swap changes cell height, and a stale row count clips the last line.
      // The WS onReady handler also calls this once the socket opens, so the size
      // actually reaches the board (the resize() above no-ops while it's still connecting).
      rafId = requestAnimationFrame(safeFit);
      document.fonts?.ready.then(safeFit);

      onDataRef.current = (data) => term.write(data);
      onExitRef.current = (code) => term.writeln(`\r\n\x1b[2m— session exited · code ${code}\x1b[0m`);

      term.onData((data) => {
        if (data === '\x04') { onDetachRef.current?.(); return; } // Ctrl+D — detach
        send(data);
      });

      const ro = new ResizeObserver(safeFit);
      ro.observe(containerRef.current!);

      return () => {
        disposed = true;
        cancelAnimationFrame(rafId);
        refitRef.current = null;
        ro.disconnect();
        term.dispose();
        termRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync theme changes into the live terminal
    React.useEffect(() => {
      if (termRef.current) termRef.current.options.theme = XTERM_THEMES[theme] ?? XTERM_THEMES.dark;
    }, [theme]);

    return (
      // xterm container — padding lives on this wrapper, NOT the mount node.
      // FitAddon measures its parent via getComputedStyle().height, which under
      // box-sizing:border-box is padding-inclusive; padding here would make it
      // over-count rows and clip the last line.
      <div
        style={{
          flex: 1, overflow: 'hidden',
          background: XTERM_THEMES[theme]?.background ?? '#070b0e',
          padding: 'var(--space-3)',
        }}
      >
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>
    );
  },
);
