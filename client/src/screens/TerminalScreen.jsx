import React from 'react';
import { Badge } from '@ds/Badge.jsx';
import { StatusDot } from '@ds/StatusDot.jsx';
import { IconButton } from '@ds/IconButton.jsx';
import { Kbd } from '@ds/Kbd.jsx';
import {
  ChevronLeft, Terminal as TerminalIcon, Copy, Maximize2, Sun, Moon,
  Search, Download, Keyboard, X, ChevronUp, ChevronDown, Send as SendIcon,
} from 'lucide-react';
import { TerminalView } from '../core/TerminalView.tsx';
import { KEY_CHIPS, composerBytes } from '../core/keyChips.ts';
import { transcriptFilename } from '../core/transcript.ts';

// Default the composer visible on touch/small viewports, hidden on a desktop
// with a real keyboard (toggleable either way). Read once at mount — a device's
// pointer class doesn't change mid-session.
function prefersComposer() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

// Chrome around the terminal: header, footer, status dot, find bar, and the
// mobile composer (input + canned-key chips). The terminal itself — xterm, the
// WS lifecycle, the mount dance, the scroll-to-bottom pill — lives in
// core/TerminalView; this screen drives it through the imperative handle.
export default function TerminalScreen({ session, host, theme, onToggleTheme, onBack }) {
  const viewRef = React.useRef(null);
  const [connStatus, setConnStatus] = React.useState('connecting');

  const [showSearch, setShowSearch] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [searchResults, setSearchResults] = React.useState({ resultIndex: -1, resultCount: -1 });
  const searchInputRef = React.useRef(null);

  const [showComposer, setShowComposer] = React.useState(prefersComposer);
  const [composerText, setComposerText] = React.useState('');

  const shellLabel = session.shell.split(/[/\\]/).pop();
  const hostLabel = host.replace(/^https?:\/\//, '');
  const dotStatus = connStatus === 'online' ? 'online'
    : connStatus === 'offline' ? 'offline'
    : 'idle';
  // surface connecting/reconnecting explicitly instead of a bare "idle" dot
  const statusLabel = (connStatus === 'connecting' || connStatus === 'reconnecting') ? connStatus : undefined;

  const openSearch = () => {
    setShowSearch(true);
    // focus after the bar renders
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };
  const closeSearch = () => {
    setShowSearch(false);
    setSearchTerm('');
    setSearchResults({ resultIndex: -1, resultCount: -1 });
    viewRef.current?.clearSearch();
  };
  const toggleSearch = () => (showSearch ? closeSearch() : openSearch());

  const runSearch = (term) => {
    setSearchTerm(term);
    if (term) viewRef.current?.searchNext(term);
    else { viewRef.current?.clearSearch(); setSearchResults({ resultIndex: -1, resultCount: -1 }); }
  };

  const downloadTranscript = () => {
    const text = viewRef.current?.serialize() ?? '';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = transcriptFilename(session.name, new Date().toISOString());
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const sendChip = (seq) => viewRef.current?.send(seq);
  const submitComposer = () => {
    if (!composerText) return;
    viewRef.current?.send(composerBytes(composerText));
    setComposerText('');
  };

  const matchReadout = searchResults.resultCount > 0
    ? `${searchResults.resultIndex + 1}/${searchResults.resultCount}`
    : searchTerm && searchResults.resultCount === 0 ? '0/0' : '';

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
          <IconButton label="Search output" active={showSearch} onClick={toggleSearch}>
            <Search size={15} />
          </IconButton>
          <IconButton label="Download transcript" onClick={downloadTranscript}>
            <Download size={15} />
          </IconButton>
          <IconButton label="Toggle composer" active={showComposer} onClick={() => setShowComposer((v) => !v)}>
            <Keyboard size={15} />
          </IconButton>
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

      {/* find bar */}
      {showSearch && (
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-4)',
          background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)',
        }}>
          <Search size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          <input
            ref={searchInputRef}
            value={searchTerm}
            onChange={(e) => runSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? viewRef.current?.searchPrev(searchTerm) : viewRef.current?.searchNext(searchTerm); }
              else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
            }}
            placeholder="Find in output…"
            style={{
              flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-strong)',
            }}
          />
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)',
            color: 'var(--text-faint)', minWidth: 40, textAlign: 'right',
          }}>
            {matchReadout}
          </span>
          <IconButton size="sm" label="Previous match" onClick={() => viewRef.current?.searchPrev(searchTerm)}>
            <ChevronUp size={15} />
          </IconButton>
          <IconButton size="sm" label="Next match" onClick={() => viewRef.current?.searchNext(searchTerm)}>
            <ChevronDown size={15} />
          </IconButton>
          <IconButton size="sm" label="Close search" onClick={closeSearch}>
            <X size={15} />
          </IconButton>
        </div>
      )}

      <TerminalView
        ref={viewRef}
        sessionId={session.id}
        theme={theme}
        onDetach={onBack}
        onSearchToggle={toggleSearch}
        onStatusChange={setConnStatus}
        onSearchResults={setSearchResults}
      />

      {/* mobile answer mode: canned-key chips + composer input */}
      {showComposer && (
        <div style={{
          flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)',
          background: 'var(--surface-card)', borderTop: '1px solid var(--border-subtle)',
        }}>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {KEY_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                title={chip.title ?? chip.label}
                aria-label={chip.title ?? chip.label}
                onClick={() => sendChip(chip.seq)}
                style={{
                  flexShrink: 0, height: 34, minWidth: 40, padding: '0 12px',
                  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-sunken)', color: 'var(--text-strong)',
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', cursor: 'pointer',
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <input
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitComposer(); } }}
              placeholder="Type a reply, then Send…"
              enterKeyHint="send"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              style={{
                flex: 1, minWidth: 0, height: 40, padding: '0 var(--space-3)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                background: 'var(--surface-app)', color: 'var(--text-strong)', outline: 'none',
                fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)',
              }}
            />
            <IconButton label="Send" bordered onClick={submitComposer} disabled={!composerText}>
              <SendIcon size={16} />
            </IconButton>
          </div>
        </div>
      )}

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
          <Kbd keys={['Ctrl', 'F']} /> find
          <Kbd keys={['Ctrl', 'D']} /> detach
        </span>
      </footer>
    </div>
  );
}
