import React from 'react';
import { useSessions } from '../core/useSessions.ts';
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

// The desktop shell: a master-detail workspace over the shared client core, no
// screen-swapping. Owns the one piece of state the mobile shell doesn't need —
// which session the detail pane is attached to — and keeps it here at the root
// so the notification wiring can select a session from outside the sidebar.
// Everything session-related still flows through useSessions; this
// component only decides selection, filtering, and Alt+N routing.
export function DesktopWorkspace({ theme, onToggleTheme, onToggleShell }) {
  const { sessions, create, kill, creating, load } = useSessions();
  const [query, setQuery] = React.useState('');
  const [selectedId, setSelectedId] = React.useState(null);
  // Deliberate "no selection" — the operator stepped back to the home overview.
  // Distinct from the transient null of a fresh load: it suppresses auto-select
  // so the home pane isn't immediately overwritten by the most-recent session.
  const [home, setHome] = React.useState(false);
  const [dialog, setDialog] = React.useState(false);
  const [createError, setCreateError] = React.useState('');
  // The spectator grid's watch set: an ordered list of session ids shown as
  // panes when non-empty (else the single-terminal / home view). Built via the
  // sidebar's inject arrow; focus (which pane is interactive) rides selectedId.
  const [gridIds, setGridIds] = React.useState([]);

  // Every selection funnels through here so it also leaves the home state: a
  // sidebar row, an Alt+N chord, or a notification click all mean "attach a
  // terminal", which is never "stay home". A row already in the grid focuses its
  // pane (stays in grid mode); any other row leaves the grid for the single view.
  const selectSession = React.useCallback((id) => {
    setHome(false);
    setSelectedId(id);
    setGridIds((prev) => (prev.includes(id) ? prev : []));
  }, []);

  // Local browser notifications. Fires off the same poll data (transition-based,
  // via the tested reducer); a notification click routes selection through
  // selectSession — the sidebar never owns selection, and a click leaves home.
  const notify = useDesktopNotifications(sessions, selectSession);

  // Visible (post-filter) partition, poll order preserved. Alt+N and the
  // sidebar render from the SAME liveSessions array, so the chord always lands
  // on the row the operator sees at that position. Memoized on [sessions, q] so
  // liveSessions keeps a stable identity across renders that don't change the
  // visible set (typing elsewhere, toggling the dialog): the Alt+N effect below
  // depends on it by reference and would otherwise tear down and re-add its
  // document listener on every render.
  const q = query.trim().toLowerCase();
  const { liveSessions, endedSessions } = React.useMemo(() => {
    const matches = (s) => `${s.name} ${s.cwd}`.toLowerCase().includes(q);
    return {
      liveSessions: sessions.filter((s) => s.status !== 'exited' && matches(s)),
      endedSessions: sessions.filter((s) => s.status === 'exited' && matches(s)),
    };
  }, [sessions, q]);
  const liveCount = sessions.filter((s) => s.status !== 'exited').length;

  // Grid derivations. liveById is keyed off ALL live sessions (not the filtered
  // liveSessions) so a sidebar filter never prunes a watched pane. panes drops
  // any watched id whose session has exited/vanished; the grid is active only
  // while panes is non-empty, and focus (the interactive pane) is selectedId
  // when it's a pane, else the first.
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

  // Keep gridIds free of dead panes so focus/state never point at a gone id.
  // panes preserves order+identity, so after this settles the lengths match and
  // it no-ops (no render loop).
  React.useEffect(() => {
    if (panes.length !== gridIds.length) setGridIds(panes);
  }, [panes, gridIds.length]);

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
  // Suppressed while `home` is set: a deliberate deselect must not be clobbered
  // back into a terminal by the next poll (that's the whole point of the home
  // state — see goHome).
  React.useEffect(() => {
    if (home || selectedId !== null) return;
    const next = pickMostRecentLive(sessions);
    if (next) setSelectedId(next.id);
  }, [home, selectedId, sessions]);

  // Release a selection whose session has vanished for good: a selected
  // tombstone evicted from the board's 20-cap ring leaves selectedId pointing at
  // a session resolveSelection can no longer return, so the pane would otherwise
  // strand on a frozen ghost with its dismiss control already gone. Clearing it
  // lets the auto-select effect pick a live row. Transient absences resolve via
  // the cache above and never reach here.
  React.useEffect(() => {
    if (orphaned) { selectedRef.current = null; setSelectedId(null); }
  }, [orphaned]);

  // Alt+1..9 -> the Nth visible live row. jumpIndexFromKey is the one
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
      setCreateError('Could not create the session. Check the server and try again.');
    }
  };

  // Step back to the neutral fleet overview without killing or dismissing
  // anything. Clearing the ref too so resolveSelection can't resurrect the last
  // terminal from its transient-absence cache.
  const goHome = () => { setHome(true); setSelectedId(null); selectedRef.current = null; };

  // Terminating the session you're viewing sends you home rather than stranding
  // the pane on the dead terminal's exit banner; the tombstone still lands in the
  // sidebar's "Recently exited", so its exit code stays one click away. Killing
  // any other row leaves your current view untouched.
  const handleKill = (id) => {
    kill(id);
    if (id === selectedId) goHome();
  };

  // Dismissing a tombstone removes it entirely; if it was the selected one,
  // release the selection so the auto-select effect picks the next live session.
  const handleDismiss = (id) => {
    kill(id);
    if (id === selectedId) { selectedRef.current = null; setSelectedId(null); }
  };

  const openDialog = () => { setCreateError(''); setDialog(true); };

  // Inject a session as a grid pane and make it the interactive one. Entering
  // grid mode from a single terminal seeds the currently-viewed session as the
  // first pane, so injecting Session 2 while viewing Session 1 gives [1, 2] —
  // not a lone [2] that drops Session 1 from view. Idempotent on re-inject.
  const handleInject = (id) => {
    setHome(false);
    setGridIds((prev) => {
      const base = prev.length === 0 && selectedId && selectedId !== id ? [selectedId] : prev;
      return injectPane(base, id);
    });
    setSelectedId(id);
  };
  // Click a grid pane -> focus it (interactive). No grid/home change; the other
  // panes stay attached as spectators.
  const handleFocusPane = (id) => { setSelectedId(id); };
  // Remove a pane from the grid (does NOT end the session). When the last pane
  // goes, gridActive falls false and the view returns to the single terminal.
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
        />
      )}
    </div>
  );
}
