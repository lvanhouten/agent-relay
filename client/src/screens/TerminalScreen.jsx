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

function useSessionWS(sessionId, token, { onData, onExit }) {
  const [connStatus, setConnStatus] = React.useState('connecting');
  const wsRef = React.useRef(null);

  React.useEffect(() => {
    if (!sessionId) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    const ws = new WebSocket(`${proto}//${location.host}/sessions/${sessionId}${qs}`);
    wsRef.current = ws;

    ws.onopen = () => setConnStatus('online');
    ws.onclose = () => setConnStatus('offline');
    ws.onerror = () => setConnStatus('error');

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'data') onData(msg.payload);
      if (msg.type === 'exit') { setConnStatus('offline'); onExit(msg.code); }
    };

    return () => { ws.close(); wsRef.current = null; };
  // onData/onExit are stable refs — intentionally excluded from deps
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

  const onDataRef = React.useRef(null);
  const onExitRef = React.useRef(null);
  const onBackRef = React.useRef(onBack);
  React.useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  const { connStatus, send, resize } = useSessionWS(session.id, token, {
    onData: React.useCallback((data) => onDataRef.current?.(data), []),
    onExit: React.useCallback((code) => onExitRef.current?.(code), []),
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
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    onDataRef.current = (data) => term.write(data);
    onExitRef.current = (code) => term.writeln(`\r\n\x1b[2m— session exited · code ${code}\x1b[0m`);

    term.onData((data) => {
      if (data === '\x04') { onBackRef.current?.(); return; } // Ctrl+D — detach
      send(data);
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      resize(term.cols, term.rows);
    });
    ro.observe(containerRef.current);

    return () => {
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
  const dotStatus = connStatus === 'online' ? 'online' : connStatus === 'offline' ? 'offline' : 'idle';

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
          <StatusDot status={dotStatus} size="sm" />
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

      {/* xterm container */}
      <div
        ref={containerRef}
        style={{
          flex: 1, overflow: 'hidden',
          background: XTERM_THEMES[theme]?.background ?? '#070b0e',
          padding: 'var(--space-3)',
        }}
      />

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
