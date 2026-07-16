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
import { shouldXtermConsumeKey } from './keyPassthrough.ts';
import styles from './TerminalView.module.scss';

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
  // 'interactive' (the default): fit xterm to the container and push the size to
  // the board. 'spectator': adopt the reported PTY dims (cols/rows below) and
  // CSS-scale the grid to fit the pane, never fit, never send resize — a
  // watch-only pane for the desktop grid. Mode is fixed for the
  // component's life; a switch is a remount by the consumer.
  mode?: TerminalViewMode;
  // Reported PTY grid from the session DTO/poll. Spectator mode adopts these and
  // rescales when they change; ignored in interactive mode (xterm's fit owns the
  // size there).
  cols?: number;
  rows?: number;
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
  // When provided and it returns true for a keydown, xterm does not consume
  // that event (nothing is written to the PTY) and the native event keeps
  // bubbling, so a document-level listener still sees it — the escape hatch
  // the desktop shell's Alt+digit session-jump chord needs. Absent, behavior
  // is unchanged from today (xterm handles every keydown itself).
  passthroughKeys?: (e: KeyboardEvent) => boolean;
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

    // These refs exist to bridge the useSessionWS socket effect, which
    // intentionally excludes its callbacks from its dependency array (so a callback
    // identity change doesn't tear down and reconnect the WS). The stable callbacks
    // passed to the hook read through these refs; the xterm mount effect below fills
    // them in. Without the refs the hook would either reconnect on every render or
    // capture stale closures. See useSessionWS's exhaustive-deps opt-out.
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
      // On (re)connect the socket is finally OPEN, so push the fitted size to the
      // board — the mount-time fit fires before the WS opens and gets dropped. On a
      // reconnect, reset the terminal first so the board's scrollback replay repaints
      // current state instead of appending a duplicate below the stale buffer; the
      // pill resets with it since the buffer is now empty and pinned to bottom.
      onReady: React.useCallback((reconnected: boolean) => {
        if (reconnected) {
          termRef.current?.reset();
          setPillState(PILL_INIT);
          // The reset emptied the buffer, so search decorations and the find
          // bar's n/m readout refer to text that no longer exists — clear both
          // (a stale "3/5" over a freshly-replayed buffer with zero highlights
          // otherwise survives until the next keystroke).
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
      // Interactive: fit xterm to the container and push the size to the board.
      // The trailing refresh forces a full client-side repaint: a (re)focused
      // pane fits/resizes in quick succession and xterm's renderer can be left
      // with a partially-painted frame (stale rows, a phantom scrollbar);
      // refresh() repaints from the buffer with no PTY round-trip.
      const safeFit = () => {
        if (disposed || !containerRef.current) return;
        fit.fit();
        resize(term.cols, term.rows);
        term.refresh(0, term.rows - 1);
      };
      // Spectator: adopt the reported PTY dims and CSS-scale the whole grid down
      // to fit the pane — never fit, never send resize (that would clamp the
      // shared line). `.xterm-screen`'s offset size is the true grid pixel box
      // (transform-independent). The mount must be sized to that natural box
      // first: left at 100% it's the pane size, so the wide grid overflows the
      // viewport (clip + scrollbar) and scaling the pane-sized box just shrinks
      // the visible sliver. Size mount = natural, THEN scale to fit. Top-left
      // origin; the wrapper clips.
      const applyScale = () => {
        const wrap = wrapperRef.current, mount = containerRef.current;
        if (disposed || !wrap || !mount) return;
        const screen = mount.querySelector('.xterm-screen') as HTMLElement | null;
        if (!screen || !screen.offsetWidth || !screen.offsetHeight) return;
        const w = screen.offsetWidth, h = screen.offsetHeight;
        mount.style.width = `${w}px`;
        mount.style.height = `${h}px`;
        const scale = Math.min(wrap.clientWidth / w, wrap.clientHeight / h);
        mount.style.transformOrigin = 'top left';
        mount.style.transform = `scale(${scale})`;
      };
      // Reconfigure the live terminal for the given mode without reattaching.
      // Interactive reclaims the pane (drop the scale transform, accept input,
      // fit + resize — re-entering the board clamp); spectator adopts the PTY
      // dims and CSS-scales, captures no input, sends no resize (leaving the
      // clamp). The relayout is deferred a frame so xterm has flushed the resize
      // before applyScale measures `.xterm-screen`.
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

      // Scroll-pill bookkeeping: a line feed while detached counts toward the
      // "n new" badge; any scroll recomputes pinned-ness. onScroll's argument is
      // the new viewportY, but we read both positions off the buffer so the two
      // events share one source.
      const recomputeScroll = () => {
        const b = term.buffer.active;
        setPillState(pillOnScroll(pillRef.current, b.viewportY, b.baseY));
      };
      term.onScroll(recomputeScroll);
      term.onLineFeed(() => setPillState(pillOnLine(pillRef.current)));

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

    // Sync theme changes into the live terminal
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
