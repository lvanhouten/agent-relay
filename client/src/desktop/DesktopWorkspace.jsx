import React from 'react';
import { useSessions } from '../core/useSessions.ts';
import { useToast } from '../core/useToast.tsx';
import { useDesktopNotifications } from '../core/useDesktopNotifications.ts';
import { jumpIndexFromKey, isTypingTarget } from '../core/jumpKeys.ts';
import { pickMostRecentLive } from '../core/recency.ts';
import { resolveSelection } from '../core/resolveSelection.ts';
import { injectPane, removePane, prunePanes, focusedPane } from '../core/gridPanes.ts';
import { NewSessionDialog, rememberClaudeDefaults } from '../chrome/NewSessionDialog.jsx';
import { Sidebar } from './Sidebar.jsx';
import { DetailPane } from './DetailPane.jsx';
import { HomePane } from './HomePane.jsx';
import { PaneGrid } from './PaneGrid.jsx';
import styles from './DesktopWorkspace.module.scss';

// Master-detail workspace over the shared client core. Owns selection state (which
// mobile doesn't need) here at the root so notification wiring can select from
// outside the sidebar; useSessions remains the source of truth for everything else.
export function DesktopWorkspace({ theme, onToggleTheme, onToggleShell }) {
  const { notifier } = useToast();
  const { sessions, create, kill, creating, load } = useSessions(notifier);
  const [query, setQuery] = React.useState('');
  const [selectedId, setSelectedId] = React.useState(null);
  // Deliberate "no selection" (stepped back to home), distinct from a fresh load's
  // transient null — suppresses auto-select so home isn't overwritten right away.
  const [home, setHome] = React.useState(false);
  const [dialog, setDialog] = React.useState(false);
  // Set when opened from a "new in this directory" action; undefined otherwise.
  const [dialogCwd, setDialogCwd] = React.useState(undefined);
  const [createError, setCreateError] = React.useState('');
  // Spectator grid's watch set; non-empty means grid view instead of single/home.
  // Focus (which pane is interactive) rides selectedId.
  const [gridIds, setGridIds] = React.useState([]);

  // Every selection funnels through here so it also leaves home. A row already
  // in the grid focuses its pane; any other row leaves the grid for the single view.
  const selectSession = React.useCallback((id) => {
    setHome(false);
    setSelectedId(id);
    setGridIds((prev) => (prev.includes(id) ? prev : []));
  }, []);

  // Notification click routes through selectSession, so it also leaves home.
  const notify = useDesktopNotifications(sessions, selectSession);

  // Alt+N and the sidebar render from this SAME array, so the chord lands on the
  // row the operator sees. Memoized so identity stays stable across unrelated
  // renders — the Alt+N effect depends on it by reference to avoid listener churn.
  const q = query.trim().toLowerCase();
  const { liveSessions, endedSessions } = React.useMemo(() => {
    const matches = (s) => `${s.name} ${s.cwd}`.toLowerCase().includes(q);
    return {
      liveSessions: sessions.filter((s) => s.status !== 'exited' && matches(s)),
      endedSessions: sessions.filter((s) => s.status === 'exited' && matches(s)),
    };
  }, [sessions, q]);
  const liveCount = sessions.filter((s) => s.status !== 'exited').length;

  // Keyed off ALL live sessions, not the filtered liveSessions, so a sidebar
  // filter never prunes a watched pane.
  const liveById = React.useMemo(() => {
    const m = new Map();
    for (const s of sessions) if (s.status !== 'exited') m.set(s.id, s);
    return m;
  }, [sessions]);
  const panes = React.useMemo(
    () => prunePanes(gridIds, new Set(liveById.keys())),
    [gridIds, liveById],
  );
  const gridActive = panes.length > 0;
  const focusedGridId = focusedPane(panes, selectedId);

  // Keep gridIds free of dead panes; lengths match once settled, so this no-ops.
  React.useEffect(() => {
    if (panes.length !== gridIds.length) setGridIds(panes);
  }, [panes, gridIds.length]);

  // resolveSelection prefers the live match, else the cached selection while it's
  // transiently absent (fresh create, kill-suppression gap) to avoid a flash-empty
  // pane; returns null once an evicted tombstone can no longer resolve (see below).
  const selectedRef = React.useRef(null);
  const selected = resolveSelection(sessions, selectedId, selectedRef.current);
  if (selected) selectedRef.current = selected;
  const orphaned = selectedId !== null && selected === null;

  // Guarded on selectedId, not `selected`: an explicit selection stands even before
  // it appears in the list (fresh create) or after it exits (keeps its banner).
  // Suppressed while `home`, or the next poll would clobber a deliberate deselect.
  React.useEffect(() => {
    if (home || selectedId !== null) return;
    const next = pickMostRecentLive(sessions);
    if (next) setSelectedId(next.id);
  }, [home, selectedId, sessions]);

  // A tombstone evicted from the board's 20-cap ring would strand the pane on a
  // frozen ghost with no dismiss control; clear it so auto-select picks a live row.
  React.useEffect(() => {
    if (orphaned) { selectedRef.current = null; setSelectedId(null); }
  }, [orphaned]);

  // Alt+1..9 -> the Nth visible live row; fires even while the terminal has focus.
  React.useEffect(() => {
    const onKey = (e) => {
      const idx = jumpIndexFromKey(e);
      if (idx === null) return;
      // Don't hijack Alt+digit while typing in the filter, a dialog field, or the find bar.
      if (isTypingTarget(document.activeElement)) return;
      const target = liveSessions[idx - 1];
      if (!target) return;
      e.preventDefault();
      selectSession(target.id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [liveSessions, selectSession]);

  const handleCreate = async (opts) => {
    setCreateError('');
    try {
      const session = await create(opts);
      if (!session) return; // dropped by the re-entrancy guard — first click still in flight
      rememberClaudeDefaults(opts.command ?? '');
      selectedRef.current = session; // show it immediately, before the poll catches up
      setHome(false);
      setSelectedId(session.id);
      setDialog(false);
      load();
    } catch {
      // Inline text covers the dialog-open case; the toast survives it closing.
      const msg = 'Could not create the session. Check the server and try again.';
      setCreateError(msg);
      notifier.notify({ severity: 'error', message: msg });
    }
  };

  // Clears the ref too, so resolveSelection can't resurrect the last terminal.
  const goHome = () => { setHome(true); setSelectedId(null); selectedRef.current = null; };

  // Killing the viewed session sends you home instead of stranding the pane on
  // its exit banner; the tombstone still lands in "Recently exited".
  const handleKill = (id) => {
    kill(id);
    if (id === selectedId) goHome();
  };

  const handleDismiss = (id) => {
    kill(id);
    if (id === selectedId) { selectedRef.current = null; setSelectedId(null); }
  };

  // cwd is a string only from a "new in this directory" action; the sidebar
  // button passes a click event, so anything non-string means blank.
  const openDialog = (cwd) => {
    setCreateError('');
    setDialogCwd(typeof cwd === 'string' ? cwd : undefined);
    setDialog(true);
  };

  // Entering grid mode seeds the currently-viewed session as the first pane, so
  // injecting session 2 while viewing 1 gives [1, 2], not a lone [2].
  const handleInject = (id) => {
    setHome(false);
    setGridIds((prev) => {
      const base = prev.length === 0 && selectedId && selectedId !== id ? [selectedId] : prev;
      return injectPane(base, id);
    });
    setSelectedId(id);
  };
  const handleFocusPane = (id) => { setSelectedId(id); };
  // Does NOT end the session; when the last pane goes, view returns to single terminal.
  const handleRemovePane = (id) => { setGridIds((prev) => removePane(prev, id)); };

  return (
    <div className={styles.workspace}>
      <Sidebar
        liveSessions={liveSessions}
        endedSessions={endedSessions}
        liveCount={liveCount}
        selectedId={selectedId}
        home={home && !selected}
        query={query}
        onQuery={setQuery}
        onHome={goHome}
        onSelect={selectSession}
        onInject={handleInject}
        onKill={handleKill}
        onDismiss={handleDismiss}
        onNewSession={openDialog}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onToggleShell={onToggleShell}
        notifyView={notify.view}
        onToggleNotify={notify.toggle}
      />
      {gridActive ? (
        <PaneGrid
          panes={panes}
          byId={liveById}
          focusedId={focusedGridId}
          theme={theme}
          onFocus={handleFocusPane}
          onRemove={handleRemovePane}
        />
      ) : selected ? (
        <DetailPane
          session={selected}
          theme={theme}
          onKill={handleKill}
          onNewInDir={openDialog}
        />
      ) : (
        <HomePane
          sessions={sessions}
          onSelect={selectSession}
          onNewSession={openDialog}
        />
      )}
      {dialog && (
        <NewSessionDialog
          onClose={() => setDialog(false)}
          onCreate={handleCreate}
          error={createError}
          busy={creating}
          initialCwd={dialogCwd}
        />
      )}
    </div>
  );
}
