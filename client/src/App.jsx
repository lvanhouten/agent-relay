import React from 'react';
import LoginScreen from './screens/LoginScreen.jsx';
import SessionsScreen from './screens/SessionsScreen.jsx';
import TerminalScreen from './screens/TerminalScreen.jsx';
import { readFragmentToken, stripFragment } from './core/fragmentPairing.ts';
import { decideBoot } from './core/boot.ts';
import { login, listSessions } from './core/api.ts';

export default function App() {
  // 'boot' is a transient loading state — first paint decides among the
  // three boot paths (fragment login, ambient-cookie probe, manual form)
  // before committing to 'login' or 'sessions', so a valid cookie or a QR
  // fragment never flashes the login form first.
  const [screen, setScreen] = React.useState('boot');
  const [host, setHost] = React.useState('');
  const [loginError, setLoginError] = React.useState('');
  const [theme, setTheme] = React.useState(
    () => localStorage.getItem('ar-theme') ?? 'dark'
  );
  const [activeSession, setActiveSession] = React.useState(null);

  // Captured once via useState's lazy initializer — NOT re-read inside the
  // boot effect below. React 18 StrictMode double-invokes effects in dev
  // (mount -> cleanup -> mount again) to surface missing-cleanup bugs; if the
  // token were read from window.location.hash inside the effect, the first
  // invocation's history.replaceState would strip it before the second
  // invocation ever ran, silently losing the fragment (and the stale-pairing
  // error path) on every dev boot. The lazy initializer runs against the
  // still-intact hash regardless of how many times React invokes it.
  const [fragmentToken] = React.useState(() => readFragmentToken(window.location.hash));

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ar-theme', theme);
  }, [theme]);

  // First-paint boot decision (VC-3, VC-4, VC-5, VC-7, VC-15). The fragment is
  // stripped from the address bar immediately, before either network call the
  // decision might make — a rotated/stale token still leaves no trace in the
  // URL. decideBoot itself is pure (client/src/core/boot.ts); this effect only
  // wires it to the real fragment/login/probe calls.
  React.useEffect(() => {
    let cancelled = false;

    if (fragmentToken) {
      window.history.replaceState(null, '', stripFragment(window.location.href));
    }

    decideBoot(fragmentToken, {
      login: async (t) => {
        try { return await login(t); } catch { return false; }
      },
      probe: async () => {
        try { await listSessions(); return true; } catch { return false; }
      },
    }).then((outcome) => {
      if (cancelled) return;
      setHost(window.location.origin);
      if (outcome.screen === 'sessions') {
        setScreen('sessions');
      } else {
        setLoginError(outcome.error ?? '');
        setScreen('login');
      }
    });

    return () => { cancelled = true; };
  }, []);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <div style={{ height: '100dvh', overflow: 'hidden' }}>
      {screen === 'boot' && (
        <div style={{
          height: '100%', display: 'grid', placeItems: 'center',
          background: 'var(--surface-app)', color: 'var(--text-faint)',
          fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
        }}>
          Connecting…
        </div>
      )}
      {screen === 'login' && (
        <LoginScreen
          theme={theme}
          onToggleTheme={toggleTheme}
          initialError={loginError}
          onConnect={(h) => { setHost(h); setScreen('sessions'); }}
        />
      )}
      {screen === 'sessions' && (
        <SessionsScreen
          host={host}
          theme={theme}
          onToggleTheme={toggleTheme}
          onAttach={(s) => { setActiveSession(s); setScreen('terminal'); }}
        />
      )}
      {screen === 'terminal' && activeSession && (
        <TerminalScreen
          session={activeSession}
          host={host}
          theme={theme}
          onToggleTheme={toggleTheme}
          onBack={() => setScreen('sessions')}
        />
      )}
    </div>
  );
}
