import React from 'react';
import SessionsScreen from './screens/SessionsScreen.jsx';
import TerminalScreen from './screens/TerminalScreen.jsx';
import { useSessions } from './core/useSessions.ts';
import { NewSessionDialog, rememberClaudeDefaults } from './chrome/NewSessionDialog.jsx';

// The mobile shell: the login → sessions → terminal screen stack over the shared
// client core. Mirrors DesktopWorkspace's split — the shell component owns the
// data layer (useSessions), the sub-navigation, and the ONE create dialog, so
// SessionsScreen/TerminalScreen stay presenters. Owning the dialog here (not in
// SessionsScreen) is what lets the terminal spawn a sibling in its own directory
// without bouncing back through the list.
export default function MobileShell({ host, theme, onToggleTheme, onToggleShell }) {
  const { sessions, create, kill, creating } = useSessions();
  const [screen, setScreen] = React.useState('sessions'); // 'sessions' | 'terminal'
  const [activeSession, setActiveSession] = React.useState(null);
  const [dialog, setDialog] = React.useState(false);
  // Prefilled cwd for the dialog: the current session's directory when opened
  // from the terminal's "new in this directory" action, undefined from scratch.
  const [dialogCwd, setDialogCwd] = React.useState(undefined);
  const [createError, setCreateError] = React.useState('');

  const attach = (s) => { setActiveSession(s); setScreen('terminal'); };

  // cwd is a string only from a "new in this directory" action; the sessions
  // header button passes a click event, so anything non-string means blank.
  const openDialog = (cwd) => {
    setCreateError('');
    setDialogCwd(typeof cwd === 'string' ? cwd : undefined);
    setDialog(true);
  };

  const handleCreate = async (opts) => {
    // Keep the dialog open until create actually succeeds — a failure surfaces
    // inline instead of vanishing into an unhandled rejection. The re-entrancy
    // guard lives in useSessions.create; a dropped double-click returns null.
    setCreateError('');
    try {
      const session = await create(opts);
      if (!session) return;
      rememberClaudeDefaults(opts.command ?? '');
      setDialog(false);
      attach(session);
    } catch {
      setCreateError('Could not create the session. Check the server and try again.');
    }
  };

  return (
    <>
      {screen === 'sessions' && (
        <SessionsScreen
          host={host}
          theme={theme}
          onToggleTheme={onToggleTheme}
          onToggleShell={onToggleShell}
          sessions={sessions}
          onKill={kill}
          onAttach={attach}
          onNewSession={openDialog}
        />
      )}
      {screen === 'terminal' && activeSession && (
        <TerminalScreen
          session={activeSession}
          host={host}
          theme={theme}
          onToggleTheme={onToggleTheme}
          onBack={() => setScreen('sessions')}
          onNewInDir={openDialog}
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
    </>
  );
}
