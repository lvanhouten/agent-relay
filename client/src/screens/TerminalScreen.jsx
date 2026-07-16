import React from 'react';
import { StatusDot } from '@ds/StatusDot.jsx';
import { IconButton } from '@ds/IconButton.jsx';
import { OverflowMenu } from '@ds/OverflowMenu.jsx';
import { Kbd } from '@ds/Kbd.jsx';
import {
  ChevronLeft, Terminal as TerminalIcon, Copy, Maximize2, Minimize2, Sun, Moon,
  Search, Download, Keyboard, X, ChevronUp, ChevronDown, FolderPlus,
} from 'lucide-react';
import { TerminalView } from '../core/TerminalView.tsx';
import { KEY_CHIPS } from '../core/keyChips.ts';
import { transcriptFilename, stripAnsi } from '../core/transcript.ts';
import { searchReadout } from '../core/searchReadout.ts';
import { useFullscreen } from '../core/useFullscreen.ts';
import { useVisibleActionCount } from '../core/useVisibleActionCount.ts';
import styles from './TerminalScreen.module.scss';

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
// mobile composer (canned-key chips). The terminal itself — xterm, the
// WS lifecycle, the mount dance, the scroll-to-bottom pill — lives in
// core/TerminalView; this screen drives it through the imperative handle.
export default function TerminalScreen({ session, host, theme, onToggleTheme, onBack, onNewInDir }) {
  const viewRef = React.useRef(null);
  const actionsRowRef = React.useRef(null);
  const [connStatus, setConnStatus] = React.useState('connecting');

  const [showSearch, setShowSearch] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [searchResults, setSearchResults] = React.useState({ resultIndex: -1, resultCount: -1 });
  const searchInputRef = React.useRef(null);

  const [showComposer, setShowComposer] = React.useState(loadComposerPref);

  React.useEffect(() => {
    localStorage.setItem(COMPOSER_PREF_KEY, showComposer ? '1' : '0');
  }, [showComposer]);

  const { isFullscreen, toggleFullscreen } = useFullscreen();

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

  // Chips send raw bytes straight to the PTY. They're gated off connStatus so a
  // mid-reconnect tap can't silently drop into a closed socket.
  const composerReady = connStatus === 'online';
  const sendChip = (seq) => viewRef.current?.send(seq);

  const matchReadout = searchReadout(searchTerm, searchResults);

  // Priority order - the last entries are the first pushed into the overflow
  // menu when the header runs out of room (download is the one operators are
  // least likely to reach for on a phone).
  const actions = [
    { key: 'search', label: 'Search output', menuLabel: 'Search output', active: showSearch, onClick: toggleSearch, icon: <Search size={15} /> },
    { key: 'composer', label: 'Toggle composer', menuLabel: 'Toggle composer', active: showComposer, onClick: () => setShowComposer((v) => !v), icon: <Keyboard size={15} /> },
    { key: 'copy', label: 'Copy selection', menuLabel: 'Copy selection', onClick: () => navigator.clipboard?.writeText(viewRef.current?.getSelection() ?? ''), icon: <Copy size={15} /> },
    { key: 'new-here', label: 'New session here', menuLabel: 'New session here', onClick: () => onNewInDir?.(session.cwd), icon: <FolderPlus size={15} /> },
    { key: 'fullscreen', label: isFullscreen ? 'Exit fullscreen' : 'Fullscreen', menuLabel: isFullscreen ? 'Exit fullscreen' : 'Fullscreen', active: isFullscreen, onClick: toggleFullscreen, icon: isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} /> },
    { key: 'theme', label: 'Toggle theme', menuLabel: 'Toggle theme', onClick: onToggleTheme, icon: theme === 'dark' ? <Sun size={15} /> : <Moon size={15} /> },
    { key: 'download', label: 'Download transcript (may contain secrets echoed to the terminal)', menuLabel: 'Download transcript', onClick: downloadTranscript, icon: <Download size={15} /> },
  ];
  const visibleActionCount = useVisibleActionCount(actionsRowRef, actions.length);
  const visibleActions = actions.slice(0, visibleActionCount);
  const overflowActions = actions.slice(visibleActionCount);

  return (
    <div className={styles.screen}>
      {/* session header */}
      <header className={styles.header}>
        <IconButton label="Back to sessions" onClick={onBack}>
          <ChevronLeft size={18} />
        </IconButton>
        <TerminalIcon size={15} className={styles.termIcon} />
        <span title={session.name} className={styles.title}>
          {session.name}
        </span>
        <span className={styles.cwd}>
          {session.cwd}
        </span>
        <StatusDot status={dotStatus} size="sm" label={statusLabel} className={styles.statusDot} />
        <span className={styles.divider} />
        <div ref={actionsRowRef} className={styles.actionsRow}>
          {visibleActions.map((a) => (
            <IconButton key={a.key} label={a.label} active={a.active} onClick={a.onClick}>
              {a.icon}
            </IconButton>
          ))}
        </div>
        <div className={styles.overflowSlot}>
          <OverflowMenu items={overflowActions} />
        </div>
      </header>

      {/* find bar */}
      {showSearch && (
        <div className={styles.findBar}>
          <Search size={14} className={styles.findIcon} />
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
            className={styles.findInput}
          />
          <span className={styles.findCount}>
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

      {/* mobile answer mode: canned-key chips */}
      {showComposer && (
        <div className={styles.composer}>
          <div className={styles.chipRow}>
            {KEY_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                title={chip.title ?? chip.label}
                aria-label={chip.title ?? chip.label}
                onClick={() => sendChip(chip.seq)}
                disabled={!composerReady}
                className={styles.chip}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* status strip */}
      <footer className={styles.footer}>
        <span className={styles.hostAccent}>● {hostLabel}</span>
        <span>utf-8</span>
        <span>{shellLabel}</span>
        <span className={styles.footerRight}>
          <Kbd keys={['Ctrl', 'F']} /> find
          <Kbd keys={['Ctrl', 'D']} /> detach
        </span>
      </footer>
    </div>
  );
}
