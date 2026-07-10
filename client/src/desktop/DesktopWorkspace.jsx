import React from 'react';
import { useSessions } from '../core/useSessions.ts';
import { useDesktopNotifications } from '../core/useDesktopNotifications.ts';
import { jumpIndexFromKey, isTypingTarget } from '../core/jumpKeys.ts';
import { pickMostRecentLive } from '../core/recency.ts';
import { resolveSelection } from '../core/resolveSelection.ts';
import { NewSessionDialog, rememberClaudeDefaults } from '../chrome/NewSessionDialog.jsx';
import { Sidebar } from './Sidebar.jsx';
import { DetailPane } from './DetailPane.jsx';
import styles from './DesktopWorkspace.module.css';

// The desktop shell: a master-detail workspace over the shared client core, no
// screen-swapping. Owns the one piece of state the mobile shell doesn't need —
// which session the detail pane is attached to — and keeps it here at the root
// so a later slice (brief 06's notifications) can select a session from outside
// the sidebar. Everything session-related still flows through useSessions; this
// component only decides selection, filtering, and Alt+N routing.
export function DesktopWorkspace({ theme, onToggleTheme, onToggleShell }) {
  const { sessions, create, kill, creating, load } = useSessions();
  const [query, setQuery] = React.useState('');
  const [selectedId, setSelectedId] = React.useState(null);
  const [dialog, setDialog] = React.useState(false);
  const [createError, setCreateError] = React.useState('');

  // Local browser notifications. Fires off the same poll data (transition-based,
  // via the tested reducer); a notification click routes selection through this
  // root's setSelectedId — the sidebar never owns selection.
  const notify = useDesktopNotifications(sessions, setSelectedId);

  // Visible (post-filter) partition, poll order preserved. Alt+N and the
  // sidebar render from the SAME liveSessions array, so the chord always lands
  // on the row the operator sees at that position.
  const q = query.trim().toLowerCase();
  const matches = (s) => `${s.name} ${s.cwd}`.toLowerCase().includes(q);
  const liveSessions = sessions.filter((s) => s.status !== 'exited' && matches(s));
  const endedSessions = sessions.filter((s) => s.status === 'exited' && matches(s));
  const liveCount = sessions.filter((s) => s.status !== 'exited').length;

  // Which session the pane shows. resolveSelection (tested) prefers the live
  // match, falls back to the cached last-known selection only while it's
  // *transiently* absent (a just-created session not yet in the poll, or the
  // one-cycle kill-suppression gap) so the pane doesn't flash empty, and returns
  // null once a selected tombstone is evicted from the board's capped ring — see
  // the orphan-clear effect below.
  const selectedRef = React.useRef(null);
  const selected = resolveSelection(sessions, selectedId, selectedRef.current);
  if (selected) selectedRef.current = selected;
  const orphaned = selectedId !== null && selected === null;

  // Auto-select the most recently active live session whenever nothing is
  // selected — the initial load, and after a selected tombstone is dismissed.
  // Guarded on selectedId (not `selected`): an explicit selection stands even
  // before it appears in the list, so a fresh create never auto-switches away,
  // and a selected session that exits keeps its banner instead of jumping.
  React.useEffect(() => {
    if (selectedId !== null) return;
    const next = pickMostRecentLive(sessions);
    if (next) setSelectedId(next.id);
  }, [selectedId, sessions]);

  // Release a selection whose session has vanished for good: a selected
  // tombstone evicted from the board's 20-cap ring leaves selectedId pointing at
  // a session resolveSelection can no longer return, so the pane would otherwise
  // strand on a frozen ghost with its dismiss control already gone. Clearing it
  // lets the auto-select effect pick a live row. Transient absences resolve via
  // the cache above and never reach here.
  React.useEffect(() => {
    if (orphaned) { selectedRef.current = null; setSelectedId(null); }
  }, [orphaned]);

  // Alt+1..9 -> the Nth visible live row. jumpIndexFromKey (brief 03) is the one
  // definition of the chord; TerminalView's passthrough leaves it un-consumed so
  // this listener fires even while the terminal has focus.
  React.useEffect(() => {
    const onKey = (e) => {
      const idx = jumpIndexFromKey(e);
      if (idx === null) return;
      // Don't hijack Alt+digit while the operator is typing in the filter, a
      // dialog field, or the find bar — only xterm's textarea lets it through.
      if (isTypingTarget(document.activeElement)) return;
      const target = liveSessions[idx - 1];
      if (!target) return;
      e.preventDefault();
      setSelectedId(target.id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [liveSessions]);

  const handleCreate = async (opts) => {
    setCreateError('');
    try {
      const session = await create(opts);
      if (!session) return; // dropped by the re-entrancy guard — first click still in flight
      rememberClaudeDefaults(opts.command ?? '');
      selectedRef.current = session; // show it immediately, before the poll catches up
      setSelectedId(session.id);
      setDialog(false);
      load();
    } catch {
      setCreateError('Could not create the session. Check the server and try again.');
    }
  };

  // Terminate keeps the selection: a killed live session becomes a tombstone and
  // the pane switches to its exit banner (no auto-switch away).
  const handleKill = (id) => { kill(id); };

  // Dismissing a tombstone removes it entirely; if it was the selected one,
  // release the selection so the auto-select effect picks the next live session.
  const handleDismiss = (id) => {
    kill(id);
    if (id === selectedId) { selectedRef.current = null; setSelectedId(null); }
  };

  const openDialog = () => { setCreateError(''); setDialog(true); };

  return (
    <div className={styles.workspace}>
      <Sidebar
        liveSessions={liveSessions}
        endedSessions={endedSessions}
        liveCount={liveCount}
        selectedId={selectedId}
        query={query}
        onQuery={setQuery}
        onSelect={setSelectedId}
        onKill={handleKill}
        onDismiss={handleDismiss}
        onNewSession={openDialog}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onToggleShell={onToggleShell}
        notifyView={notify.view}
        onToggleNotify={notify.toggle}
      />
      <DetailPane
        session={selected}
        theme={theme}
        onKill={handleKill}
        onNewSession={openDialog}
      />
      {dialog && (
        <NewSessionDialog
          onClose={() => setDialog(false)}
          onCreate={handleCreate}
          error={createError}
          busy={creating}
        />
      )}
    </div>
  );
}
