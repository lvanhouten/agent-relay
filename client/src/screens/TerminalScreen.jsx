import React from 'react';
import { Badge } from '@ds/Badge.jsx';
import { StatusDot } from '@ds/StatusDot.jsx';
import { IconButton } from '@ds/IconButton.jsx';
import { Kbd } from '@ds/Kbd.jsx';
import { ChevronLeft, Terminal as TerminalIcon, Copy, Maximize2, Sun, Moon } from 'lucide-react';
import { TerminalView } from '../core/TerminalView.tsx';

// Chrome around the terminal: header, footer, status dot. The terminal itself —
// xterm, the WS lifecycle, the mount dance — lives in core/TerminalView.
export default function TerminalScreen({ session, host, theme, onToggleTheme, onBack }) {
  const viewRef = React.useRef(null);
  const [connStatus, setConnStatus] = React.useState('connecting');

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
          <IconButton label="Copy selection" onClick={() => navigator.clipboard?.writeText(viewRef.current?.getSelection() ?? '')}>
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

      <TerminalView
        ref={viewRef}
        sessionId={session.id}
        theme={theme}
        onDetach={onBack}
        onStatusChange={setConnStatus}
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
