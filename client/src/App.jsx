import React from 'react';
import LoginScreen from './screens/LoginScreen.jsx';
import SessionsScreen from './screens/SessionsScreen.jsx';
import TerminalScreen from './screens/TerminalScreen.jsx';

export default function App() {
  const [screen, setScreen] = React.useState('login');
  const [host, setHost] = React.useState('');
  const [token, setToken] = React.useState('');
  const [theme, setTheme] = React.useState(
    () => localStorage.getItem('ar-theme') ?? 'dark'
  );
  const [activeSession, setActiveSession] = React.useState(null);

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ar-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <div style={{ height: '100dvh', overflow: 'hidden' }}>
      {screen === 'login' && (
        <LoginScreen
          theme={theme}
          onToggleTheme={toggleTheme}
          onConnect={(h, t) => { setHost(h); setToken(t); setScreen('sessions'); }}
        />
      )}
      {screen === 'sessions' && (
        <SessionsScreen
          host={host}
          token={token}
          theme={theme}
          onToggleTheme={toggleTheme}
          onAttach={(s) => { setActiveSession(s); setScreen('terminal'); }}
        />
      )}
      {screen === 'terminal' && activeSession && (
        <TerminalScreen
          session={activeSession}
          host={host}
          token={token}
          theme={theme}
          onToggleTheme={toggleTheme}
          onBack={() => setScreen('sessions')}
        />
      )}
    </div>
  );
}
