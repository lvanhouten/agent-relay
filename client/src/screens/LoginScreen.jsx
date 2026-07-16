import React from 'react';
import { Button } from '@ds/Button.jsx';
import { Input } from '@ds/Input.jsx';
import { Sun, Moon, Lock } from 'lucide-react';
import { headers, login } from '../core/api.ts';
import { isLocalhost } from '../hostTrust.js';
import styles from './LoginScreen.module.scss';

// The app is served BY the relay (or the Vite dev proxy), so every request —
// the login probe, session CRUD, the WS PTY stream — targets the page's own
// origin. There is no separate "relay host" to type: you reach a relay by
// loading this page from it (directly or through a tunnel). So the login screen
// collects only the access token and reports the origin it will talk to, rather
// than a free-text host field that (mis)implied it retargeted all traffic.

// initialError: set by the boot flow (App.jsx) when a QR-pairing fragment
// token turned out to be rotated/stale — surfaces immediately on first paint
// instead of a silent drop to a blank form.
export default function LoginScreen({ onConnect, theme, onToggleTheme, initialError = '' }) {
  const [token, setToken] = React.useState('');
  const [error, setError] = React.useState(initialError);
  const [loading, setLoading] = React.useState(false);
  // When set, the user has been warned the token would travel in cleartext and
  // must click Connect again to send it anyway.
  const [pendingCleartext, setPendingCleartext] = React.useState(false);

  const origin = window.location.origin;
  const hostLabel = window.location.host;

  const connect = async () => {
    // The only credential-safety concern left in the same-origin model: if this
    // page was itself loaded over http:// from a non-localhost host, the token
    // (Authorization header) travels unencrypted. Gate that behind a second
    // click, the same acknowledge-then-proceed pattern the typed-host flow used.
    const cleartext = token && window.location.protocol === 'http:' && !isLocalhost(origin);
    if (cleartext && !pendingCleartext) {
      setPendingCleartext(true);
      setError(
        `${hostLabel} is served over http:// — your access token would be sent in cleartext. ` +
        `Click Connect again to send it anyway, or load this page over https://.`
      );
      return;
    }
    setPendingCleartext(false);
    setError('');
    setLoading(true);
    try {
      // Relative path -> same origin (or the Vite dev proxy), so the probe hits
      // the same place all later traffic does.
      const res = await fetch('/api/sessions', { headers: headers(token) });
      if (res.status === 401) { setError('Invalid access token.'); return; }
      if (!res.ok) throw new Error();
      // The probe only proves the bearer works — exchange it for the ar_auth
      // cookie so the browser doesn't need to keep the token in memory for
      // every subsequent request (REST + WS ride the cookie from here on).
      // Only advance if the cookie was actually granted (login → 204). If the
      // exchange fails (e.g. the token rotated between the probe and here),
      // routing to sessions would immediately 401 cookie-only into the offline-
      // looking state this whole feature exists to prevent — surface it instead.
      if (!(await login(token))) {
        setError('Could not complete sign-in — try again.');
        return;
      }
      onConnect(origin);
    } catch {
      setError('Could not reach the relay. Is the server running?');
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e) => { if (e.key === 'Enter') connect(); };

  return (
    <div className={styles.screen}>
      <button onClick={onToggleTheme} className={styles.themeBtn}>
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.logo}>
            <span className={styles.logoMark}>▸</span>
            agent-relay
          </div>
          <p className={styles.tagline}>
            Connect to any session from anywhere.
          </p>
        </div>

        <div className={styles.form}>
          <Input
            label="Access token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={onKey}
            placeholder="printed in the server console at startup"
            autoFocus
          />
          {error && <p className={styles.error}>{error}</p>}
          <Button
            fullWidth
            loading={loading}
            onClick={connect}
            className={styles.connectBtn}
          >
            Connect to relay
          </Button>
          <div className={styles.hint}>
            <Lock size={11} /> connecting to {hostLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
