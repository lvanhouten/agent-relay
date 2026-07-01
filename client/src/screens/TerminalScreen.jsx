import React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Badge } from '@ds/Badge.jsx';
import { StatusDot } from '@ds/StatusDot.jsx';
import { IconButton } from '@ds/IconButton.jsx';
import { Kbd } from '@ds/Kbd.jsx';
import { ChevronLeft, Terminal as TerminalIcon, Copy, Maximize2, Sun, Moon } from 'lucide-react';

const XTERM_THEMES = {
  dark: {
    background: '#070b0e',
    foreground: '#d8dee2',
    cursor: '#1fce8a',
    cursorAccent: '#070b0e',
    selectionBackground: 'rgba(31, 206, 138, 0.2)',
    black: '#11161a', brightBlack: '#353c41',
    red: '#f4675f',   brightRed: '#f4675f',
    green: '#1fce8a', brightGreen: '#54dfa6',
    yellow: '#f3b13c',brightYellow: '#f3b13c',
    blue: '#5aa6f0',  brightBlue: '#5aa6f0',
    magenta: '#c084fc',brightMagenta: '#e879f9',
    cyan: '#8aa0b2',  brightCyan: '#b0c4d4',
    white: '#d8dee2', brightWhite: '#fafbfb',
  },
  light: {
    background: '#e9edee',
    foreground: '#2a3239',
    cursor: '#0c7650',
    cursorAccent: '#e9edee',
    selectionBackground: 'rgba(12, 118, 80, 0.2)',
    black: '#2a3239', brightBlack: '#4d555b',
    red: '#c02720',   brightRed: '#e23b34',
    green: '#0c7650', brightGreen: '#0e9462',
    yellow: '#b9790f',brightYellow: '#e0991f',
    blue: '#1f6bc0',  brightBlue: '#2f86e0',
    magenta: '#9333ea',brightMagenta: '#a855f7',
    cyan: '#2c6586',  brightCyan: '#1e7a9e',
    white: '#4d555b', brightWhite: '#21272b',
  },
};

function useSessionWS(sessionId, token, { onData, onExit, onReady }) {
  const [connStatus, setConnStatus] = React.useState('connecting');
  const wsRef = React.useRef(null);

  React.useEffect(() => {
    if (!sessionId) return;
    let stopped = false;   // component unmounted / deps changed — stop for good
    let ended = false;     // session exited or is gone — reconnecting is pointless
    let attempt = 0;
    let retryTimer = null;

    const connect = () => {
      if (stopped) return;
      setConnStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      const ws = new WebSocket(`${proto}//${location.host}/sessions/${sessionId}${qs}`);
      wsRef.current = ws;

      ws.onopen = () => {
        const reconnected = attempt > 0;
        attempt = 0;
        setConnStatus('online');
        onReady?.(reconnected);   // reconnected -> caller resets the terminal before the replay
      };

      ws.onmessage = (e) => {
        // A throw here (e.g. a malformed frame that isn't valid JSON) does NOT
        // close the socket or fire onerror/onclose — the connection would look
        // "online" but silently stop processing output, and the reconnect logic
        // would never engage. Swallow a bad frame instead of freezing the terminal.
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'data') onData(msg.payload);
        if (msg.type === 'exit') { ended = true; setConnStatus('offline'); onExit(msg.code); }
      };

      ws.onerror = () => { /* onclose drives recovery */ };

      ws.onclose = (ev) => {
        if (wsRef.current === ws) wsRef.current = null;
        if (stopped) return;
        // 1008 = unauthorized / session not found: permanent, don't retry.
        if (ended || ev.code === 1008) { setConnStatus('offline'); return; }
        setConnStatus('reconnecting');
        const delay = Math.min(500 * 2 ** attempt, 8000);   // 0.5s → 8s cap
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      const ws = wsRef.current;
      if (ws) { ws.onclose = null; ws.close(); wsRef.current = null; }
    };
  // onData/onExit/onReady are stable refs — intentionally excluded from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, token]);

  const send = React.useCallback((payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'input', payload }));
  }, []);

  const resize = React.useCallback((cols, rows) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
  }, []);

  return { connStatus, send, resize };
}

export default function TerminalScreen({ session, host, token, theme, onToggleTheme, onBack }) {
  const containerRef = React.useRef(null);
  const termRef = React.useRef(null);
  const fitRef = React.useRef(null);

  // These four refs exist to bridge the useSessionWS socket effect, which
  // intentionally excludes its callbacks from its dependency array (so a callback
  // identity change doesn't tear down and reconnect the WS). The stable callbacks
  // passed to the hook read through these refs; the xterm mount effect below fills
  // them in. Without the refs the hook would either reconnect on every render or
  // capture stale closures. See useSessionWS's exhaustive-deps opt-out above.
  const onDataRef = React.useRef(null);
  const onExitRef = React.useRef(null);
  const refitRef = React.useRef(null);
  const onBackRef = React.useRef(onBack);
  React.useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  const { connStatus, send, resize } = useSessionWS(session.id, token, {
    onData: React.useCallback((data) => onDataRef.current?.(data), []),
    onExit: React.useCallback((code) => onExitRef.current?.(code), []),
    // On (re)connect the socket is finally OPEN, so push the fitted size to the
    // board — the mount-time fit fires before the WS opens and gets dropped. On a
    // reconnect, reset the terminal first so the board's scrollback replay repaints
    // current state instead of appending a duplicate below the stale buffer.
    onReady: React.useCallback((reconnected) => {
      if (reconnected) termRef.current?.reset();
      refitRef.current?.();
    }, []),
  });

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
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

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
      if (data === '\x04') { onBackRef.current?.(); return; } // Ctrl+D — detach
      send(data);
    });

    const ro = new ResizeObserver(safeFit);
    ro.observe(containerRef.current);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      refitRef.current = null;
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync theme changes into the live terminal
  React.useEffect(() => {
    if (termRef.current) termRef.current.options.theme = XTERM_THEMES[theme] ?? XTERM_THEMES.dark;
  }, [theme]);

  const shellLabel = session.shell.split(/[/\\]/).pop();
  const hostLabel = host.replace(/^https?:\/\//, '');
  const dotStatus = connStatus === 'online' ? 'online'
    : connStatus === 'offline' ? 'offline'
    : 'idle';
  // surface connecting/reconnecting explicitly instead of a bare "idle" dot
  const statusLabel = (connStatus === 'connecting' || connStatus === 'reconnecting') ? connStatus : undefined;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface-app)' }}>
      {/* session header */}
      <header style={{
        height: 52, flexShrink: 0, display: 'flex', alignItems: 'center',
        gap: 'var(--space-3)', padding: '0 var(--space-4)',
        background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)',
      }}>
        <IconButton label="Back to sessions" onClick={onBack}>
          <ChevronLeft size={18} />
        </IconButton>
        <TerminalIcon size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{
          fontFamily: 'var(--font-display)', fontWeight: 600,
          color: 'var(--text-strong)', flexShrink: 0,
        }}>
          {session.name}
        </span>
        <Badge variant="accent">{shellLabel}</Badge>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
          color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {session.cwd}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StatusDot status={dotStatus} size="sm" label={statusLabel} />
          <span style={{ width: 1, height: 22, background: 'var(--border-subtle)', margin: '0 4px' }} />
          <IconButton label="Copy selection" onClick={() => navigator.clipboard?.writeText(termRef.current?.getSelection() ?? '')}>
            <Copy size={15} />
          </IconButton>
          <IconButton label="Fullscreen" onClick={() => document.documentElement.requestFullscreen?.()}>
            <Maximize2 size={15} />
          </IconButton>
          <IconButton label="Toggle theme" onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </IconButton>
        </div>
      </header>

      {/* xterm container — padding lives on this wrapper, NOT the mount node.
          FitAddon measures its parent via getComputedStyle().height, which under
          box-sizing:border-box is padding-inclusive; padding here would make it
          over-count rows and clip the last line. */}
      <div
        style={{
          flex: 1, overflow: 'hidden',
          background: XTERM_THEMES[theme]?.background ?? '#070b0e',
          padding: 'var(--space-3)',
        }}
      >
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* status strip */}
      <footer style={{
        height: 30, flexShrink: 0, display: 'flex', alignItems: 'center',
        gap: 'var(--space-4)', padding: '0 var(--space-5)',
        background: 'var(--surface-card)', borderTop: '1px solid var(--border-subtle)',
        fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text-faint)',
      }}>
        <span style={{ color: 'var(--text-accent)' }}>● {hostLabel}</span>
        <span>utf-8</span>
        <span>{shellLabel}</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <Kbd keys={['Ctrl', 'D']} /> detach
        </span>
      </footer>
    </div>
  );
}
