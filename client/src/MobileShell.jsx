import React from 'react';
import SessionsScreen from './screens/SessionsScreen.jsx';
import TerminalScreen from './screens/TerminalScreen.jsx';
import { useSessions } from './core/useSessions.ts';
import { useToast } from './core/useToast.tsx';
import { NewSessionDialog, rememberClaudeDefaults } from './chrome/NewSessionDialog.jsx';

// The mobile shell: sessions -> terminal screen stack. Owns the data layer
// (useSessions), sub-navigation, and the ONE create dialog, so the screens
// stay presenters - owning the dialog here is what lets the terminal spawn a
// sibling in its own directory without bouncing back through the list.
export default function MobileShell({ host, theme, onToggleTheme, onToggleShell }) {
  const { notifier } = useToast();
  const { sessions, create, kill, creating } = useSessions(notifier);
  const [screen, setScreen] = React.useState('sessions'); // 'sessions' | 'terminal'
  const [activeSession, setActiveSession] = React.useState(null);
  const [dialog, setDialog] = React.useState(false);
  // Prefilled cwd: current session's dir from "new in this directory", else undefined.
  const [dialogCwd, setDialogCwd] = React.useState(undefined);
  const [createError, setCreateError] = React.useState('');

  const attach = (s) => { setActiveSession(s); setScreen('terminal'); };

  // cwd is a string only from "new in this directory"; the header button
  // passes a click event instead, so anything non-string means blank.
  const openDialog = (cwd) => {
    setCreateError('');
    setDialogCwd(typeof cwd === 'string' ? cwd : undefined);
    setDialog(true);
  };

  const handleCreate = async (opts) => {
    // Keep the dialog open until create succeeds, so a failure surfaces inline.
    // Re-entrancy guard lives in useSessions.create; a dropped double-click returns null.
    setCreateError('');
    try {
      const session = await create(opts);
      if (!session) return;
      rememberClaudeDefaults(opts.command ?? '');
      setDialog(false);
      attach(session);
    } catch {
      // Inline text covers the dialog-open case; the toast survives it closing.
      const msg = 'Could not create the session. Check the server and try again.';
      setCreateError(msg);
      notifier.notify({ severity: 'error', message: msg });
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
