import React from 'react';
import { Button } from '@ds/Button.jsx';
import { Input } from '@ds/Input.jsx';
import { Sun, Moon } from 'lucide-react';
import { headers } from '../api.js';

const HOST_KEY = 'ar-host';
const TRUSTED_HOST_KEY = 'ar-host-trusted'; // last host a probe actually succeeded against

// localhost / loopback is inherently trusted — the token can't leave the machine.
function isLocalhost(h) {
  try {
    const { hostname } = new URL(h);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch { return false; }
}

export default function LoginScreen({ onConnect, theme, onToggleTheme }) {
  const [host, setHost] = React.useState(
    () => localStorage.getItem(HOST_KEY) ?? 'http://localhost:3017'
  );
  const [token, setToken] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  // When set, the user has been warned the host is untrusted and must click
  // Connect again to actually send the token to it.
  const [pendingHost, setPendingHost] = React.useState(null);

  const connect = async () => {
    const h = host.trim();
    if (!h) { setError('Enter a relay host.'); return; }

    // The token is sent to `h` as a Bearer header on the very first request.
    // Before doing that, refuse to hand it to a host we haven't successfully
    // connected to before, unless it's localhost — `ar-host` is only ever a
    // convenience seed and can be pre-set by a hostile actor (crafted link,
    // shared machine), so a stored value is NOT proof of trust. Require an
    // explicit second click that acknowledges the untrusted host.
    const trusted = localStorage.getItem(TRUSTED_HOST_KEY);
    if (token && !isLocalhost(h) && h !== trusted && pendingHost !== h) {
      setPendingHost(h);
      setError(`This will send your access token to ${h}, which you haven't connected to before. Click Connect again to confirm you trust this host.`);
      return;
    }
    setPendingHost(null);
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${h}/api/sessions`, { headers: headers(token) });
      if (res.status === 401) { setError('Invalid access token.'); return; }
      if (!res.ok) throw new Error();
      localStorage.setItem(HOST_KEY, h);
      localStorage.setItem(TRUSTED_HOST_KEY, h); // this host proved reachable — trust it next time
      onConnect(h, token);
    } catch {
      setError('Could not reach relay. Check the host and try again.');
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
            label="Relay host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={onKey}
            placeholder="http://localhost:3017"
            mono
          />
          <Input
            label="Access token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={onKey}
            placeholder="optional"
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
        </div>
      </div>
    </div>
  );
}
