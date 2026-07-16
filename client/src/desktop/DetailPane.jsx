import React from 'react';
import { StatusDot } from '@ds/StatusDot.jsx';
import { IconButton } from '@ds/IconButton.jsx';
import { Terminal as TerminalIcon, Search, Download, Copy, Trash2, FolderPlus } from 'lucide-react';
import { TerminalView } from '../core/TerminalView.tsx';
import { jumpIndexFromKey } from '../core/jumpKeys.ts';
import { tombstoneView } from '../core/tombstoneView.ts';
import { transcriptFilename, stripAnsi } from '../core/transcript.ts';
import { FindBar } from '../chrome/FindBar.jsx';
import styles from './DetailPane.module.scss';

// Alt+digit must escape the terminal so the workspace's document-level listener
// can select a session even while xterm has focus. TerminalView's passthrough
// leaves a matching keydown un-consumed; this predicate is the same
// one the workspace listener uses, so the two can never disagree about what a
// jump chord is.
const isJumpChord = (e) => jumpIndexFromKey(e) !== null;

// The terminal detail pane: a slim per-shell toolbar over the shared
// TerminalView. No composer / key chips (desktop has a keyboard — brief). When
// the selected session is a tombstone it keeps the dead terminal readable and
// shows an exit banner instead of retrying the (permanently refused) attach.
// Rendered only with a session — the no-selection state is the workspace's
// HomePane, not this component.
export function DetailPane({ session, theme, onKill, onNewInDir }) {
  const viewRef = React.useRef(null);
  const [connStatus, setConnStatus] = React.useState('connecting');
  const [showSearch, setShowSearch] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState({ resultIndex: -1, resultCount: -1 });

  // Search UI is per-selection; reset it when the attached session changes so a
  // stale query/readout doesn't carry across to a different terminal.
  const sessionId = session?.id ?? null;
  React.useEffect(() => {
    setShowSearch(false);
    setSearchResults({ resultIndex: -1, resultCount: -1 });
    setConnStatus('connecting');
  }, [sessionId]);

  if (!session) return null;

  const exited = session.status === 'exited';
  // Tombstone decode (dot / crash predicate / status word) is shared with the
  // sidebar row and session card via core/tombstoneView.ts so the three can't
  // drift; the detail banner below builds its fuller sentence from tomb.killed.
  const tomb = exited ? tombstoneView(session) : null;

  const dotStatus = exited ? tomb.dot
    : connStatus === 'online' ? 'online'
    : connStatus === 'offline' ? 'offline'
    : 'idle';
  const dotLabel = exited ? tomb.label
    : (connStatus === 'connecting' || connStatus === 'reconnecting') ? connStatus : undefined;

  const openSearch = () => setShowSearch(true);
  const closeSearch = () => {
    setShowSearch(false);
    setSearchResults({ resultIndex: -1, resultCount: -1 });
    viewRef.current?.clearSearch();
  };
  const toggleSearch = () => (showSearch ? closeSearch() : openSearch());

  const runSearch = (term) => {
    if (term) viewRef.current?.searchNext(term);
    else { viewRef.current?.clearSearch(); setSearchResults({ resultIndex: -1, resultCount: -1 }); }
  };

  const downloadTranscript = () => {
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

  return (
    <section className={styles.pane}>
      <div className={styles.toolbar}>
        <span className={styles.title}>
          <TerminalIcon size={15} className={styles.titleIcon} />
          <span className={styles.name}>{session.name}</span>
        </span>
        <span className={styles.cwd}>{session.cwd}</span>
        <span className={styles.spacer} />
        <span className={styles.tools}>
          <StatusDot status={dotStatus} size="sm" label={dotLabel} />
          <span className={styles.divider} />
          <IconButton label="Search output" active={showSearch} onClick={toggleSearch}>
            <Search size={15} />
          </IconButton>
          <IconButton label="Download transcript (may contain secrets echoed to the terminal)" onClick={downloadTranscript}>
            <Download size={15} />
          </IconButton>
          <IconButton label="Copy selection" onClick={() => navigator.clipboard?.writeText(viewRef.current?.getSelection() ?? '')}>
            <Copy size={15} />
          </IconButton>
          <IconButton label="New session here" onClick={() => onNewInDir?.(session.cwd)}>
            <FolderPlus size={15} />
          </IconButton>
          {!exited && (
            <IconButton label="Terminate session" onClick={() => onKill(session.id)}>
              <Trash2 size={15} />
            </IconButton>
          )}
        </span>
      </div>

      {showSearch && (
        <FindBar
          results={searchResults}
          onQuery={runSearch}
          onNext={(term) => viewRef.current?.searchNext(term)}
          onPrev={(term) => viewRef.current?.searchPrev(term)}
          onClose={closeSearch}
        />
      )}

      {exited && (
        <div className={`${styles.banner}${tomb.failed ? ' ' + styles.bannerFailed : ''}`}>
          <span>● {tomb.killed ? 'Session terminated.' : `Session exited with code ${session.exitCode ?? '?'}.`} The transcript below is read-only.</span>
        </div>
      )}

      {/* key by session id: switching selection remounts so the WS attaches to
          the newly-selected line (and a reused id after a board restart can't
          keep a stale terminal). */}
      <TerminalView
        key={session.id}
        ref={viewRef}
        sessionId={session.id}
        theme={theme}
        onSearchToggle={toggleSearch}
        onStatusChange={setConnStatus}
        onSearchResults={setSearchResults}
        passthroughKeys={isJumpChord}
      />
    </section>
  );
}
