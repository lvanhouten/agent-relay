import React from 'react';
import { Button } from '@shared/Button.jsx';
import { Input } from '@shared/Input.jsx';
import { Sun, Moon, Lock } from 'lucide-react';
import { headers, login } from '../core/api.ts';
import { isLocalhost } from '../hostTrust.js';
import styles from './LoginScreen.module.scss';

// Same-origin model: the page's own origin is the relay, so login needs only
// the access token, not a free-text host field.

// initialError: set by App's boot flow when a QR-pairing fragment token
// turned out rotated/stale, so it surfaces on first paint.
export default function LoginScreen({ onConnect, theme, onToggleTheme, initialError = '' }) {
  const [token, setToken] = React.useState('');
  const [error, setError] = React.useState(initialError);
  const [loading, setLoading] = React.useState(false);
  // Set once the user's been warned cleartext send needs a second click to proceed.
  const [pendingCleartext, setPendingCleartext] = React.useState(false);

  const origin = window.location.origin;
  const hostLabel = window.location.host;

  const connect = async () => {
    // Loaded over http:// from a non-localhost origin means the token travels
    // unencrypted - gate that behind a second click.
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
      // Relative path -> same origin (or the Vite dev proxy).
      const res = await fetch('/api/sessions', { headers: headers(token) });
      if (res.status === 401) { setError('Invalid access token.'); return; }
      if (!res.ok) throw new Error();
      // Probe only proves the bearer works; exchange it for the ar_auth cookie
      // (REST + WS ride the cookie after). Only advance on a real 204 - a failed
      // exchange would otherwise 401 straight into the sessions screen.
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
