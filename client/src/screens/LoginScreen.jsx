import React from 'react';
import { Button } from '@ds/Button.jsx';
import { Input } from '@ds/Input.jsx';
import { Sun, Moon, Lock } from 'lucide-react';
import { headers, login } from '../core/api.ts';
import { isLocalhost } from '../hostTrust.js';

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
      // Relative path -> same origin (or the Vite dev proxy). This is the whole
      // point of the fix: the probe hits the same place all later traffic does.
      const res = await fetch('/api/sessions', { headers: headers(token) });
      if (res.status === 401) { setError('Invalid access token.'); return; }
      if (!res.ok) throw new Error();
      // The probe only proves the bearer works — exchange it for the ar_auth
      // cookie so the browser doesn't need to keep the token in memory for
      // every subsequent request (REST + WS ride the cookie from here on).
      await login(token);
      onConnect(origin);
    } catch {
      setError('Could not reach the relay. Is the server running?');
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e) => { if (e.key === 'Enter') connect(); };

  return (
    <div style={{
      height: '100%', display: 'grid', placeItems: 'center',
      background: 'var(--surface-app)',
    }}>
      <button
        onClick={onToggleTheme}
        style={{
          position: 'absolute', top: 16, right: 16,
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', padding: 8, borderRadius: 'var(--radius-md)',
        }}
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <div style={{ width: '100%', maxWidth: 400, padding: 'var(--space-6)' }}>
        <div style={{ marginBottom: 'var(--space-8)', textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            fontFamily: 'var(--font-mono)', fontWeight: 700,
            fontSize: 'var(--text-xl)', color: 'var(--text-strong)',
          }}>
            <span style={{
              width: 28, height: 28, borderRadius: 6, background: 'var(--accent)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, color: 'var(--text-on-accent)',
            }}>▸</span>
            agent-relay
          </div>
          <p style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            Connect to any session from anywhere.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Input
            label="Access token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={onKey}
            placeholder="printed in the server console at startup"
            autoFocus
          />
          {error && (
            <p style={{
              color: 'var(--danger)', fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)', margin: 0,
            }}>
              {error}
            </p>
          )}
          <Button
            fullWidth
            loading={loading}
            onClick={connect}
            style={{ marginTop: 'var(--space-2)' }}
          >
            Connect to relay
          </Button>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-faint)',
          }}>
            <Lock size={11} /> connecting to {hostLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
