import React from 'react';
import { Button } from '@ds/Button.jsx';
import { Input } from '@ds/Input.jsx';
import { Sun, Moon } from 'lucide-react';

const HOST_KEY = 'ar-host';

export default function LoginScreen({ onConnect, theme, onToggleTheme }) {
  const [host, setHost] = React.useState(
    () => localStorage.getItem(HOST_KEY) ?? 'http://localhost:3001'
  );
  const [token, setToken] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const connect = async () => {
    const h = host.trim();
    if (!h) { setError('Enter a relay host.'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${h}/api/sessions`);
      if (!res.ok) throw new Error();
      localStorage.setItem(HOST_KEY, h);
      onConnect(h);
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
            placeholder="http://localhost:3001"
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
