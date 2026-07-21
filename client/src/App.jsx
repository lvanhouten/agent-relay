import React from 'react';
import LoginScreen from './screens/LoginScreen.jsx';
import MobileShell from './MobileShell.jsx';
import { DesktopWorkspace } from './desktop/DesktopWorkspace.jsx';
import { readFragmentToken, stripFragment } from './core/fragmentPairing.ts';
import { decideBoot } from './core/boot.ts';
import { decideShell, readShellOverride, writeShellOverride } from './core/shellSelection.ts';
import { login, listSessions } from './core/api.ts';
import { ToastProvider } from './core/useToast.tsx';
import { ToastHost } from './chrome/ToastHost.jsx';
import styles from './App.module.scss';

export default function App() {
  // 'boot' is transient: first paint decides among fragment login,
  // ambient-cookie probe, or manual form before committing to 'login' or
  // 'sessions', so a valid cookie/QR fragment never flashes the login form.
  const [screen, setScreen] = React.useState('boot');
  const [host, setHost] = React.useState('');
  const [loginError, setLoginError] = React.useState('');
  const [theme, setTheme] = React.useState(
    () => localStorage.getItem('ar-theme') ?? 'dark'
  );

  // Shell selection: measured once at load, sticky for the window's lifetime -
  // no resize listener, so crossing the layout boundary never swaps shells.
  // Override lives in sessionStorage (per-window, so a desk "force desktop"
  // can't leak into a phone-over-RDP window sharing the origin). See
  // core/shellSelection.ts.
  const [shell, setShell] = React.useState(() =>
    decideShell({
      width: window.innerWidth,
      height: window.innerHeight,
      override: readShellOverride(window.sessionStorage),
    })
  );
  const toggleShell = () => setShell((cur) => {
    const next = cur === 'desktop' ? 'mobile' : 'desktop';
    writeShellOverride(window.sessionStorage, next);
    return next;
  });

  // Captured via useState's lazy initializer, not re-read in the effect below:
  // StrictMode's dev double-invoke would otherwise strip the hash on the first
  // pass and lose the fragment before the second invocation ever ran.
  const [fragmentToken] = React.useState(() => readFragmentToken(window.location.hash));

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ar-theme', theme);
  }, [theme]);

  // The fragment is stripped from the address bar before either network call,
  // so a rotated/stale token leaves no trace in the URL. decideBoot itself is
  // pure (core/boot.ts); this effect just wires it to the real calls.
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
    <div className={styles.root}>
      {screen === 'boot' && (
        <div className={styles.boot}>
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
      {/* Each shell owns its data layer + create dialog and sub-navigates
          internally; App only gates on authenticated `sessions` state.
          ToastProvider wraps both so their data layers can push in-app toasts;
          host renders corner-anchored on desktop, bottom-anchored on mobile. */}
      {screen === 'sessions' && (
        <ToastProvider>
          {shell === 'desktop' ? (
            <DesktopWorkspace
              theme={theme}
              onToggleTheme={toggleTheme}
              onToggleShell={toggleShell}
            />
          ) : (
            <MobileShell
              host={host}
              theme={theme}
              onToggleTheme={toggleTheme}
              onToggleShell={toggleShell}
            />
          )}
          <ToastHost placement={shell === 'mobile' ? 'bottom' : 'corner'} />
        </ToastProvider>
      )}
    </div>
  );
}
