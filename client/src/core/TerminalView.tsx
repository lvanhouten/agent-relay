import React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';
import { useSessionWS } from './useSessionWS.ts';
import { XTERM_THEMES } from './xtermThemes.ts';
import { PILL_INIT, onScroll as pillOnScroll, onLine as pillOnLine } from './scrollPill.ts';
import type { PillState } from './scrollPill.ts';
import type { ConnStatus, TerminalViewMode, SearchResults } from './types.ts';

// Search highlight colors — a warm yellow that reads on both the dark and light
// xterm themes. Enabling decorations is also what makes SearchAddon compute a
// reliable resultCount for the find bar's "n/m" readout.
const SEARCH_OPTS = {
  decorations: {
    matchBackground: '#7a6a1e',
    matchOverviewRuler: '#c2a83e',
    activeMatchBackground: '#e0b71c',
    activeMatchColorOverviewRuler: '#e0b71c',
  },
} as const;

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
  // Ctrl+F inside the terminal — the screen opens its find bar. Intercepted here
  // (like Ctrl+D) so xterm doesn't swallow it and the browser's own find never
  // takes over while the terminal has focus.
  onSearchToggle?: () => void;
  // Fires whenever the WS connection status changes, incl. the initial
  // 'connecting'. For chrome (status dots) outside this component.
  onStatusChange?: (status: ConnStatus) => void;
  // Live search match position/count from the search addon, for the find bar's
  // readout. resultCount is -1 when the addon hasn't computed it.
  onSearchResults?: (results: SearchResults) => void;
}

export interface TerminalViewHandle {
  // Current xterm selection, for clipboard chrome outside the component.
  getSelection(): string;
  // Write raw bytes down the WS input frame — the composer bar and canned-key
  // chips (mobile answer mode) push their sequences through here. Returns false
  // when the socket isn't open (the bytes were dropped, not queued) so callers
  // can keep the user's text rather than clear it as if delivered.
  send(data: string): boolean;
  // The client-side buffer as text (replayed scrollback since attach, capped at
  // the board's per-line chunk limit) — for the transcript download.
  serialize(): string;
  // Find-bar controls. Each call re-runs the query from the current position so
  // the screen needn't cache the term. clearSearch drops highlights on close.
  searchNext(term: string): void;
  searchPrev(term: string): void;
  clearSearch(): void;
}

// The terminal proper: owns the xterm instance, its themes, the mount dance
// (fit timing, font-load refit, padding-on-wrapper-not-mount-node), the session
// WebSocket, and the scroll-to-bottom pill (furniture bound to live scroll
// state, kept internal rather than plumbed out). Chrome that drives the terminal
// from outside — find bar, composer, header buttons — stays in the consuming
// screen and reaches in through the imperative handle.
export const TerminalView = React.forwardRef<TerminalViewHandle, TerminalViewProps>(
  function TerminalView({ sessionId, theme, onDetach, onSearchToggle, onStatusChange, onSearchResults }, handleRef) {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const termRef = React.useRef<Terminal | null>(null);
    const searchRef = React.useRef<SearchAddon | null>(null);
    const serializeRef = React.useRef<SerializeAddon | null>(null);

    // Scroll-pill state. The ref is the source of truth the xterm event handlers
    // read/update synchronously; the state mirror drives the pill's render.
    const pillRef = React.useRef<PillState>(PILL_INIT);
    const [pill, setPill] = React.useState<PillState>(PILL_INIT);
    const setPillState = React.useCallback((next: PillState) => {
      pillRef.current = next;
      setPill(next);
    }, []);

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
    const onSearchToggleRef = React.useRef(onSearchToggle);
    const onSearchResultsRef = React.useRef(onSearchResults);
    React.useEffect(() => { onDetachRef.current = onDetach; }, [onDetach]);
    React.useEffect(() => { onSearchToggleRef.current = onSearchToggle; }, [onSearchToggle]);
    React.useEffect(() => { onSearchResultsRef.current = onSearchResults; }, [onSearchResults]);

    const { connStatus, send, resize } = useSessionWS(sessionId, undefined, {
      onData: React.useCallback((data: string) => onDataRef.current?.(data), []),
      onExit: React.useCallback((code: number | null) => onExitRef.current?.(code), []),
      // On (re)connect the socket is finally OPEN, so push the fitted size to the
      // board — the mount-time fit fires before the WS opens and gets dropped. On a
      // reconnect, reset the terminal first so the board's scrollback replay repaints
      // current state instead of appending a duplicate below the stale buffer; the
      // pill resets with it since the buffer is now empty and pinned to bottom.
      onReady: React.useCallback((reconnected: boolean) => {
        if (reconnected) {
          termRef.current?.reset();
          setPillState(PILL_INIT);
        }
        refitRef.current?.();
      }, [setPillState]),
    });

    // Report status to the chrome outside. Bridged through a ref so a new
    // callback identity doesn't re-fire the effect with a stale status.
    const onStatusChangeRef = React.useRef(onStatusChange);
    React.useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);
    React.useEffect(() => { onStatusChangeRef.current?.(connStatus); }, [connStatus]);

    React.useImperativeHandle(handleRef, () => ({
      getSelection: () => termRef.current?.getSelection() ?? '',
      send: (data: string) => send(data),
      serialize: () => serializeRef.current?.serialize() ?? '',
      searchNext: (term: string) => { searchRef.current?.findNext(term, SEARCH_OPTS); },
      searchPrev: (term: string) => { searchRef.current?.findPrevious(term, SEARCH_OPTS); },
      clearSearch: () => {
        searchRef.current?.clearDecorations();
        searchRef.current?.clearActiveDecoration?.();
      },
    }), [send]);

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
      const search = new SearchAddon();
      const serialize = new SerializeAddon();
      term.loadAddon(fit);
      term.loadAddon(search);
      term.loadAddon(serialize);
      term.open(containerRef.current!);
      termRef.current = term;
      searchRef.current = search;
      serializeRef.current = serialize;

      search.onDidChangeResults((r) => onSearchResultsRef.current?.(r));

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
        if (data === '\x06') { onSearchToggleRef.current?.(); return; } // Ctrl+F — find bar
        send(data);
      });

      // Scroll-pill bookkeeping: a line feed while detached counts toward the
      // "n new" badge; any scroll recomputes pinned-ness (re-reaching bottom
      // clears the count). onScroll's argument is the new viewportY, but we read
      // both positions off the buffer so the two events share one source.
      const recomputeScroll = () => {
        const b = term.buffer.active;
        setPillState(pillOnScroll(pillRef.current, b.viewportY, b.baseY));
      };
      term.onScroll(recomputeScroll);
      term.onLineFeed(() => setPillState(pillOnLine(pillRef.current)));

      const ro = new ResizeObserver(safeFit);
      ro.observe(containerRef.current!);

      return () => {
        disposed = true;
        cancelAnimationFrame(rafId);
        refitRef.current = null;
        searchRef.current = null;
        serializeRef.current = null;
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

    const jumpToBottom = () => {
      termRef.current?.scrollToBottom();
      setPillState(PILL_INIT);
    };

    return (
      // xterm container — padding lives on this wrapper, NOT the mount node.
      // FitAddon measures its parent via getComputedStyle().height, which under
      // box-sizing:border-box is padding-inclusive; padding here would make it
      // over-count rows and clip the last line. position:relative anchors the
      // scroll-to-bottom pill over the viewport.
      <div
        style={{
          flex: 1, overflow: 'hidden', position: 'relative',
          background: XTERM_THEMES[theme]?.background ?? '#070b0e',
          padding: 'var(--space-3)',
        }}
      >
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        {!pill.atBottom && (
          <button
            type="button"
            onClick={jumpToBottom}
            aria-label="Scroll to latest output"
            style={{
              position: 'absolute', bottom: 'var(--space-4)', left: '50%', transform: 'translateX(-50%)',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 'var(--radius-full, 999px)',
              border: '1px solid var(--border-strong)', background: 'var(--surface-card)',
              color: 'var(--text-strong)', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
              boxShadow: 'var(--shadow-2, 0 4px 12px rgba(0,0,0,.35))',
            }}
          >
            ↓ {pill.newLines > 0 ? `${pill.newLines} new` : 'latest'}
          </button>
        )}
      </div>
    );
  },
);
