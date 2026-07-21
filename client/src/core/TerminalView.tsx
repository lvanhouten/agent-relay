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
import { wheelScrollLines, touchScrollLines, takeWholeLines } from './terminalScroll.ts';
import type { ScrollEnv } from './terminalScroll.ts';
import type { ConnStatus, TerminalViewMode, SearchResults } from './types.ts';
import { shouldXtermConsumeKey } from './keyPassthrough.ts';
import styles from './TerminalView.module.scss';

// Warm yellow that reads on both themes; decorations must stay on so
// SearchAddon computes resultCount for the find bar's "n/m" readout.
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
  // 'interactive' (default): fits xterm, pushes size to the board. 'spectator':
  // adopts reported PTY dims (below), CSS-scales, never resizes — the desktop
  // grid's watch-only panes. Fixed per mount; a switch is a remount.
  mode?: TerminalViewMode;
  // Reported PTY grid from the session DTO/poll. Spectator adopts + rescales on
  // change; ignored in interactive mode (xterm's own fit owns size there).
  cols?: number;
  rows?: number;
  // Ctrl+D inside the terminal — detach without ending the session.
  onDetach?: () => void;
  // Ctrl+F — opens the find bar. Intercepted (like Ctrl+D) so xterm doesn't
  // swallow it and the browser's own find never fires while focused.
  onSearchToggle?: () => void;
  // Fires whenever the WS connection status changes, incl. the initial
  // 'connecting'. For chrome (status dots) outside this component.
  onStatusChange?: (status: ConnStatus) => void;
  // Live search match position/count from the search addon, for the find bar's
  // readout. resultCount is -1 when the addon hasn't computed it.
  onSearchResults?: (results: SearchResults) => void;
  // Returning true for a keydown lets it bubble past xterm unconsumed (nothing
  // sent to the PTY) — the escape hatch the desktop Alt+digit jump chord needs.
  // Absent, xterm consumes every keydown as usual.
  passthroughKeys?: (e: KeyboardEvent) => boolean;
}

export interface TerminalViewHandle {
  // Current xterm selection, for clipboard chrome outside the component.
  getSelection(): string;
  // Writes raw bytes to the WS input frame (composer + canned-key chips use
  // this). Returns false if the socket isn't open — bytes were dropped, not
  // queued — so the caller should keep the user's text instead of clearing it.
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

// Owns the xterm instance, themes, mount dance (fit timing, font-load refit,
// wrapper padding), the session WebSocket, and the scroll-to-bottom pill.
// Outside chrome (find bar, composer, header) drives it via the imperative handle.
export const TerminalView = React.forwardRef<TerminalViewHandle, TerminalViewProps>(
  function TerminalView({ sessionId, theme, mode = 'interactive', cols, rows, onDetach, onSearchToggle, onStatusChange, onSearchResults, passthroughKeys }, handleRef) {
    const wrapperRef = React.useRef<HTMLDivElement | null>(null);
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

    // Bridge refs for useSessionWS's callbacks (excluded from its deps so a
    // callback identity change doesn't reconnect the WS); the mount effect below
    // fills them in. Without these the hook would reconnect every render or
    // capture stale closures.
    const onDataRef = React.useRef<((data: string) => void) | null>(null);
    const onExitRef = React.useRef<((code: number | null) => void) | null>(null);
    const refitRef = React.useRef<(() => void) | null>(null);
    // Reconfigures the live terminal for interactive vs spectator (filled by the
    // mount effect, called by the mode-change effect) — the pane never remounts
    // on focus change, so mode is applied in place.
    const applyModeRef = React.useRef<((spectator: boolean) => void) | null>(null);
    // Latest reported PTY dims, read when entering spectator mode.
    const colsRef = React.useRef(cols);
    const rowsRef = React.useRef(rows);
    React.useEffect(() => { colsRef.current = cols; rowsRef.current = rows; }, [cols, rows]);
    const onDetachRef = React.useRef(onDetach);
    const onSearchToggleRef = React.useRef(onSearchToggle);
    const onSearchResultsRef = React.useRef(onSearchResults);
    const passthroughKeysRef = React.useRef(passthroughKeys);
    React.useEffect(() => { onDetachRef.current = onDetach; }, [onDetach]);
    React.useEffect(() => { onSearchToggleRef.current = onSearchToggle; }, [onSearchToggle]);
    React.useEffect(() => { onSearchResultsRef.current = onSearchResults; }, [onSearchResults]);
    React.useEffect(() => { passthroughKeysRef.current = passthroughKeys; }, [passthroughKeys]);

    const { connStatus, send, resize } = useSessionWS(sessionId, undefined, {
      onData: React.useCallback((data: string) => onDataRef.current?.(data), []),
      onExit: React.useCallback((code: number | null) => onExitRef.current?.(code), []),
      // Socket open: push the fitted size (the mount-time fit fires before the WS
      // opens and gets dropped). On reconnect, reset first so the replay repaints
      // rather than appending below stale content; the pill resets with the empty buffer.
      onReady: React.useCallback((reconnected: boolean) => {
        if (reconnected) {
          termRef.current?.reset();
          setPillState(PILL_INIT);
          // Buffer reset invalidates search decorations and the n/m readout —
          // clear both, or a stale "3/5" survives over the freshly-replayed buffer.
          searchRef.current?.clearDecorations();
          searchRef.current?.clearActiveDecoration?.();
          onSearchResultsRef.current?.({ resultIndex: -1, resultCount: -1 });
        }
        refitRef.current?.();
      }, [setPillState]),
    }, mode);

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

    // Mount once per pane. Mode changes go through applyMode(), never a remount:
    // remounting re-runs the history replay into a live pipe.
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
      // Interactive: fit + push size to the board. The trailing refresh forces a
      // full repaint — a rapid refocus fit/resize can leave xterm's renderer with
      // a stale partial frame; refresh() repaints from the buffer, no PTY round-trip.
      const safeFit = () => {
        if (disposed || !containerRef.current) return;
        fit.fit();
        resize(term.cols, term.rows);
        term.refresh(0, term.rows - 1);
      };
      // Spectator: CSS-scale the whole grid to fit, never fit/resize (would clamp
      // the shared line). `.xterm-screen`'s offset size is the true, transform-
      // independent grid box — size the mount to that natural box FIRST, then
      // scale; scaling a pane-sized mount first just shrinks a clipped sliver.
      const applyScale = () => {
        const wrap = wrapperRef.current, mount = containerRef.current;
        if (disposed || !wrap || !mount) return;
        const screen = mount.querySelector('.xterm-screen') as HTMLElement | null;
        if (!screen || !screen.offsetWidth || !screen.offsetHeight) return;
        const w = screen.offsetWidth, h = screen.offsetHeight;
        mount.style.width = `${w}px`;
        mount.style.height = `${h}px`;
        // clientWidth/Height include padding, but the mount fills only the content
        // box — scale to that or the thumbnail overscales into the gutter.
        const cs = getComputedStyle(wrap);
        const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        const scale = Math.min(availW / w, availH / h);
        mount.style.transformOrigin = 'top left';
        mount.style.transform = `scale(${scale})`;
      };
      // Reconfigures the live terminal in place, no reattach. Interactive: drop
      // scale, accept input, fit+resize (re-enters the board clamp). Spectator:
      // adopt PTY dims, CSS-scale, no input, no resize (stays clamped). Deferred a
      // frame so xterm flushes the resize before applyScale measures `.xterm-screen`.
      const applyMode = (spec: boolean) => {
        if (disposed) return;
        const mount = containerRef.current;
        term.options.disableStdin = spec;
        term.options.cursorBlink = !spec;
        if (spec) {
          const c = colsRef.current, r = rowsRef.current;
          if (c && r) term.resize(c, r);
          refitRef.current = applyScale;
        } else {
          if (mount) { mount.style.transform = 'none'; mount.style.width = ''; mount.style.height = ''; }
          refitRef.current = safeFit;
          term.focus();
        }
        rafId = requestAnimationFrame(() => refitRef.current?.());
      };
      applyModeRef.current = applyMode;

      // Apply the initial mode, then relayout again once the monospace font has
      // loaded (font swap changes cell size). For interactive, onReady also
      // refits once the socket opens so the size reaches the board.
      applyMode(mode === 'spectator');
      document.fonts?.ready.then(() => refitRef.current?.());

      onDataRef.current = (data) => term.write(data);
      onExitRef.current = (code) => term.writeln(`\r\n\x1b[2m— session exited · code ${code}\x1b[0m`);

      // Input, the detach/find chords, and the Alt+digit passthrough are
      // registered once; while spectating, `disableStdin` blocks onData so none
      // fire, and they resume when the pane is refocused (applyMode toggles it).
      term.onData((data) => {
        if (data === '\x04') { onDetachRef.current?.(); return; } // Ctrl+D — detach
        if (data === '\x06') { onSearchToggleRef.current?.(); return; } // Ctrl+F — find bar
        send(data);
      });
      // Runs before xterm's own keydown handling — see keyPassthrough.ts.
      term.attachCustomKeyEventHandler((e) => shouldXtermConsumeKey(passthroughKeysRef.current, e));

      // A line feed while detached counts toward the "n new" badge; any scroll
      // recomputes pinned-ness. Both positions are read off the buffer (not
      // onScroll's arg) so the two events share one source.
      const recomputeScroll = () => {
        const b = term.buffer.active;
        setPillState(pillOnScroll(pillRef.current, b.viewportY, b.baseY));
      };
      term.onScroll(recomputeScroll);
      term.onLineFeed(() => setPillState(pillOnLine(pillRef.current)));

      // Reclaims scrollback from mouse-grabbing apps (Claude Code, vim, less) and
      // adds touch scroll, which xterm 6 lacks entirely. Math lives in
      // core/terminalScroll; here: xterm wiring + a fractional-line accumulator
      // for smooth sub-line deltas. Cell height reads off `.xterm-screen`
      // (transform-independent), so it holds while spectating.
      const scrollEnv = (): ScrollEnv => {
        const screen = containerRef.current?.querySelector('.xterm-screen') as HTMLElement | null;
        const cellHeight = screen && term.rows ? screen.clientHeight / term.rows : 20;
        return { bufferType: term.buffer.active.type, mouseTracking: term.modes.mouseTrackingMode, cellHeight, rows: term.rows };
      };
      let wheelCarry = 0;
      // Returning false suppresses xterm's default (forward-to-PTY); returning
      // true defers to it — either the app owns the alt screen or, with no mouse
      // tracking, xterm's own viewport already scrolls and taking over would
      // double-scroll.
      term.attachCustomWheelEventHandler((ev) => {
        const lines = wheelScrollLines(ev.deltaY, ev.deltaMode, scrollEnv());
        if (lines === null) return true;
        const { whole, rest } = takeWholeLines(wheelCarry, lines);
        wheelCarry = rest;
        if (whole !== 0) term.scrollLines(whole);
        return false;
      });

      // Touch: xterm 6's viewport wires up no gesture handling, so a one-finger
      // drag scrolls nothing on a phone regardless of mouse mode. Translate the
      // drag into local scrollback ourselves; multitouch is left to the browser.
      let lastTouchY: number | null = null;
      let touchCarry = 0;
      const el = containerRef.current!;
      const onTouchStart = (e: TouchEvent) => { lastTouchY = e.touches.length === 1 ? e.touches[0].clientY : null; };
      const onTouchMove = (e: TouchEvent) => {
        if (lastTouchY === null || e.touches.length !== 1) return;
        const y = e.touches[0].clientY;
        const lines = touchScrollLines(y - lastTouchY, scrollEnv());
        if (lines === null) return;
        lastTouchY = y;
        const { whole, rest } = takeWholeLines(touchCarry, lines);
        touchCarry = rest;
        if (whole !== 0) term.scrollLines(whole);
        e.preventDefault();
      };
      const onTouchEnd = () => { lastTouchY = null; touchCarry = 0; };
      el.addEventListener('touchstart', onTouchStart, { passive: true });
      el.addEventListener('touchmove', onTouchMove, { passive: false });
      el.addEventListener('touchend', onTouchEnd, { passive: true });
      el.addEventListener('touchcancel', onTouchEnd, { passive: true });

      // Observe the wrapper (the pane) for both modes: interactive fits to it,
      // spectator rescales to it. A mode change doesn't resize the wrapper, so
      // applyMode drives that relayout itself.
      const ro = new ResizeObserver(() => refitRef.current?.());
      ro.observe(wrapperRef.current!);

      return () => {
        disposed = true;
        cancelAnimationFrame(rafId);
        refitRef.current = null;
        applyModeRef.current = null;
        searchRef.current = null;
        serializeRef.current = null;
        el.removeEventListener('touchstart', onTouchStart);
        el.removeEventListener('touchmove', onTouchMove);
        el.removeEventListener('touchend', onTouchEnd);
        el.removeEventListener('touchcancel', onTouchEnd);
        ro.disconnect();
        term.dispose();
        termRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Focus/mode change: reconfigure in place (no remount, no reattach).
    React.useEffect(() => { applyModeRef.current?.(mode === 'spectator'); }, [mode]);

    // Spectator dims propagate via the sessions poll (≤5s lag is acceptable).
    // On change, re-adopt them and rescale; no-op while interactive.
    React.useEffect(() => {
      if (mode !== 'spectator') return;
      const term = termRef.current;
      if (!term || !cols || !rows) return;
      term.resize(cols, rows);
      refitRef.current?.();
    }, [mode, cols, rows]);

    React.useEffect(() => {
      if (termRef.current) termRef.current.options.theme = XTERM_THEMES[theme] ?? XTERM_THEMES.dark;
    }, [theme]);

    const jumpToBottom = () => {
      termRef.current?.scrollToBottom();
      setPillState(PILL_INIT);
    };

    return (
      <div ref={wrapperRef} className={`${styles.wrapper}${mode === 'spectator' ? ' ' + styles.spectator : ''}`}>
        <div ref={containerRef} className={styles.mount} />
        {!pill.atBottom && (
          <button
            type="button"
            onClick={jumpToBottom}
            aria-label="Scroll to latest output"
            className={styles.pill}
          >
            ↓ {pill.newLines > 0 ? `${pill.newLines} new` : 'latest'}
          </button>
        )}
      </div>
    );
  },
);
