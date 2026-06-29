import React from 'react';
import { Badge } from '@ds/Badge.jsx';
import { StatusDot } from '@ds/StatusDot.jsx';
import { IconButton } from '@ds/IconButton.jsx';
import { Kbd } from '@ds/Kbd.jsx';
import { ChevronLeft, Terminal, Copy, Maximize2, Sun, Moon } from 'lucide-react';
import { stripAnsi } from '../utils/stripAnsi.js';

function useSessionWS(sessionId) {
  const [lines, setLines] = React.useState([]);
  const [connStatus, setConnStatus] = React.useState('connecting');
  const wsRef = React.useRef(null);
  const bufRef = React.useRef('');

  React.useEffect(() => {
    if (!sessionId) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/sessions/${sessionId}`);
    wsRef.current = ws;

    ws.onopen = () => setConnStatus('online');
    ws.onclose = () => setConnStatus('offline');
    ws.onerror = () => setConnStatus('error');

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'data') {
        bufRef.current += stripAnsi(msg.payload);
        const parts = bufRef.current.split('\n');
        bufRef.current = parts.pop(); // hold incomplete last line
        const newLines = parts
          .map((t) => t.trimEnd())
          .filter((t) => t.length > 0)
          .map((text) => ({ type: 'raw', text }));
        if (newLines.length) setLines((prev) => [...prev, ...newLines]);
      }
      if (msg.type === 'exit') {
        setConnStatus('offline');
        setLines((prev) => [...prev, { type: 'sys', text: `session exited · code ${msg.code}` }]);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  const send = React.useCallback((payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', payload }));
    }
  }, []);

  const resize = React.useCallback((cols, rows) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  return { lines, connStatus, send, resize };
}

function TranscriptLine({ line }) {
  switch (line.type) {
    case 'sys':
      return (
        <div style={{ color: 'var(--terminal-accent)', opacity: 0.8, margin: '6px 0', fontSize: 'var(--text-xs)' }}>
          — {line.text}
        </div>
      );
    default:
      return (
        <div style={{ color: 'var(--terminal-fg)', lineHeight: 1.6, wordBreak: 'break-all' }}>
          {line.text}
        </div>
      );
  }
}

export default function TerminalScreen({ session, host, theme, onToggleTheme, onBack }) {
  const { lines, connStatus, send } = useSessionWS(session.id);
  const [input, setInput] = React.useState('');
  const viewRef = React.useRef(null);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (viewRef.current) {
      viewRef.current.scrollTop = viewRef.current.scrollHeight;
    }
  }, [lines.length]);

  const doSend = () => {
    const text = input.trim();
    if (!text) return;
    send(text + '\n');
    setInput('');
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  };

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
        <Terminal size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
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
          <IconButton label="Copy buffer" onClick={() => navigator.clipboard?.writeText(lines.map((l) => l.text).join('\n'))}>
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

      {/* transcript */}
      <div
        ref={viewRef}
        onClick={() => inputRef.current?.focus()}
        style={{
          flex: 1, overflowY: 'auto', background: 'var(--terminal-bg)',
          fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', lineHeight: 1.6,
          padding: 'var(--space-5) var(--space-6)', cursor: 'text',
        }}
      >
        <div style={{ maxWidth: 880 }}>
          {lines.length === 0 && connStatus === 'connecting' && (
            <div style={{ color: 'var(--terminal-dim)', opacity: 0.7 }}>Attaching to session…</div>
          )}
          {lines.map((l, i) => <TranscriptLine key={i} line={l} />)}
        </div>
      </div>

      {/* input bar */}
      <div style={{
        flexShrink: 0, background: 'var(--terminal-bg)',
        borderTop: '1px solid var(--terminal-border)',
        padding: 'var(--space-4) var(--space-6) var(--space-3)',
      }}>
        <div style={{ maxWidth: 880 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            border: '1px solid var(--terminal-border)', borderRadius: 'var(--radius-lg)',
            padding: '11px 14px', background: 'var(--surface-card)',
          }}>
            <span style={{ color: 'var(--terminal-accent)', fontWeight: 700 }}>›</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              autoFocus
              spellCheck={false}
              placeholder="Ask the session to do something…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text-strong)', fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)', caretColor: 'var(--terminal-accent)',
              }}
            />
          </div>
          <div style={{
            display: 'flex', gap: 16, marginTop: 8, paddingLeft: 4,
            color: 'var(--terminal-dim)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)',
          }}>
            <span>enter to send</span>
            <span>esc to cancel a run</span>
          </div>
        </div>
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
