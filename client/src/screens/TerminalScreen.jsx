import React from 'react';
import { Badge } from '@ds/Badge.jsx';
import { StatusDot } from '@ds/StatusDot.jsx';
import { IconButton } from '@ds/IconButton.jsx';
import { OverflowMenu } from '@ds/OverflowMenu.jsx';
import { Kbd } from '@ds/Kbd.jsx';
import {
  ChevronLeft, Terminal as TerminalIcon, Copy, Maximize2, Minimize2, Sun, Moon,
  Search, Download, Keyboard, X, ChevronUp, ChevronDown, Send as SendIcon,
} from 'lucide-react';
import { TerminalView } from '../core/TerminalView.tsx';
import { KEY_CHIPS, composerBytes } from '../core/keyChips.ts';
import { transcriptFilename, stripAnsi } from '../core/transcript.ts';
import { searchReadout } from '../core/searchReadout.ts';
import { useFullscreen } from '../core/useFullscreen.ts';
import { useVisibleActionCount } from '../core/useVisibleActionCount.ts';
import { useMediaQuery } from '../core/useMediaQuery.ts';

// Default the composer visible on touch/small viewports, hidden on a desktop
// with a real keyboard (toggleable either way). Read once at mount — a device's
// pointer class doesn't change mid-session.
function prefersComposer() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

// An explicit toggle (either way) should stick across sessions instead of
// re-deriving from pointer type every time a terminal screen mounts — the
// device heuristic above is only the first-ever default.
const COMPOSER_PREF_KEY = 'ar-composer-open';
function loadComposerPref() {
  const stored = localStorage.getItem(COMPOSER_PREF_KEY);
  return stored === null ? prefersComposer() : stored === '1';
}

// Chrome around the terminal: header, footer, status dot, find bar, and the
// mobile composer (input + canned-key chips). The terminal itself — xterm, the
// WS lifecycle, the mount dance, the scroll-to-bottom pill — lives in
// core/TerminalView; this screen drives it through the imperative handle.
export default function TerminalScreen({ session, host, theme, onToggleTheme, onBack }) {
  const viewRef = React.useRef(null);
  const actionsRowRef = React.useRef(null);
  const [connStatus, setConnStatus] = React.useState('connecting');

  const [showSearch, setShowSearch] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [searchResults, setSearchResults] = React.useState({ resultIndex: -1, resultCount: -1 });
  const searchInputRef = React.useRef(null);

  const [showComposer, setShowComposer] = React.useState(loadComposerPref);
  const [composerText, setComposerText] = React.useState('');

  React.useEffect(() => {
    localStorage.setItem(COMPOSER_PREF_KEY, showComposer ? '1' : '0');
  }, [showComposer]);

  const { isFullscreen, toggleFullscreen } = useFullscreen();
  // Narrow viewports have far less header room to spend on the title before
  // the action buttons start collapsing into the overflow menu.
  const isNarrowViewport = useMediaQuery('(max-width: 480px)');

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
    // serialize() reproduces terminal state incl. ANSI escapes; the export is
    // a .txt, so strip them (core/transcript.ts) or Notepad shows \x1b[ noise.
    const text = stripAnsi(viewRef.current?.serialize() ?? '');
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

  // The composer exists for flaky mobile moments — the same moments the socket
  // is mid-reconnect and send() drops the bytes. Only clear the input when the
  // send actually reached an open socket; the chips/Send button are also gated
  // off connStatus below, but the return check covers the status-vs-socket race.
  const composerReady = connStatus === 'online';
  const sendChip = (seq) => viewRef.current?.send(seq);
  const submitComposer = () => {
    if (!composerText) return;
    if (viewRef.current?.send(composerBytes(composerText))) setComposerText('');
  };

  const matchReadout = searchReadout(searchTerm, searchResults);

  // Priority order - the last entries are the first pushed into the overflow
  // menu when the header runs out of room (download is the one operators are
  // least likely to reach for on a phone).
  const actions = [
    { key: 'search', label: 'Search output', menuLabel: 'Search output', active: showSearch, onClick: toggleSearch, icon: <Search size={15} /> },
    { key: 'composer', label: 'Toggle composer', menuLabel: 'Toggle composer', active: showComposer, onClick: () => setShowComposer((v) => !v), icon: <Keyboard size={15} /> },
    { key: 'copy', label: 'Copy selection', menuLabel: 'Copy selection', onClick: () => navigator.clipboard?.writeText(viewRef.current?.getSelection() ?? ''), icon: <Copy size={15} /> },
    { key: 'fullscreen', label: isFullscreen ? 'Exit fullscreen' : 'Fullscreen', menuLabel: isFullscreen ? 'Exit fullscreen' : 'Fullscreen', active: isFullscreen, onClick: toggleFullscreen, icon: isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} /> },
    { key: 'theme', label: 'Toggle theme', menuLabel: 'Toggle theme', onClick: onToggleTheme, icon: theme === 'dark' ? <Sun size={15} /> : <Moon size={15} /> },
    { key: 'download', label: 'Download transcript (may contain secrets echoed to the terminal)', menuLabel: 'Download transcript', onClick: downloadTranscript, icon: <Download size={15} /> },
  ];
  const visibleActionCount = useVisibleActionCount(actionsRowRef, actions.length);
  const visibleActions = actions.slice(0, visibleActionCount);
  const overflowActions = actions.slice(visibleActionCount);

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
        {/* Shrink-only, capped - a long session name must ellipsize instead
            of growing unbounded and pushing the badge/cwd/actions off the
            header (it still wins the fight over cwd below via maxWidth). */}
        <span title={session.name} style={{
          fontFamily: 'var(--font-display)', fontWeight: 600,
          color: 'var(--text-strong)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          minWidth: 0, maxWidth: isNarrowViewport ? 140 : 280, flex: '0 1 auto',
        }}>
          {session.name}
        </span>
        <Badge variant="accent">{shellLabel}</Badge>
        {/* Shrink-only (no grow) - it gives up room under pressure but doesn't
            compete with the actions row below for surplus space, so slack
            goes to buttons rather than padding out an already-fitting path. */}
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
          color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          minWidth: 0, flex: '0 1 auto',
        }}>
          {session.cwd}
        </span>
        <StatusDot status={dotStatus} size="sm" label={statusLabel} style={{ flexShrink: 0 }} />
        <span style={{ width: 1, height: 22, background: 'var(--border-subtle)', margin: '0 4px', flexShrink: 0 }} />
        {/* The only flex-grow item in the row - a direct header child, not
            nested, so it actually receives a definite width from header's own
            flex layout. Its resolved clientWidth IS "room CSS gave the
            buttons" - see useVisibleActionCount above for why that's the
            thing to measure. */}
        <div ref={actionsRowRef} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: 'var(--space-2)', flex: '1 1 0', minWidth: 0, overflow: 'hidden',
        }}>
          {visibleActions.map((a) => (
            <IconButton key={a.key} label={a.label} active={a.active} onClick={a.onClick}>
              {a.icon}
            </IconButton>
          ))}
        </div>
        {/* Always reserved, whether or not the menu has anything in it - a
            conditionally-present trigger would change the row's fixed cost
            between renders and throw off the flex-grow measurement above. */}
        <div style={{ width: 36, flexShrink: 0 }}>
          <OverflowMenu items={overflowActions} />
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
              // A CJK/predictive-keyboard candidate confirmation arrives as
              // Enter mid-composition — it must not run the search early.
              if (e.nativeEvent.isComposing) return;
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
                disabled={!composerReady}
                style={{
                  flexShrink: 0, height: 34, minWidth: 40, padding: '0 12px',
                  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-sunken)', color: 'var(--text-strong)',
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
                  cursor: composerReady ? 'pointer' : 'not-allowed',
                  opacity: composerReady ? 1 : 0.45,
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
              // isComposing: a mobile-IME candidate confirmation must not
              // submit half-composed text to a live agent (this input exists
              // for exactly those keyboards).
              onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); submitComposer(); } }}
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
            <IconButton label="Send" bordered onClick={submitComposer} disabled={!composerText || !composerReady}>
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
