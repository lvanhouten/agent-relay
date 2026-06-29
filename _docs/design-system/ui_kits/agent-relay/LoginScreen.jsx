// agent-relay · Login screen — authenticate to a relay host.
const { Button, Input } = window.AgentRelayDesignSystem_9f29b7;

function LoginScreen({ onConnect, theme, onToggleTheme }) {
  const [host, setHost] = React.useState('main.local:7070');
  const [token, setToken] = React.useState('relay-demo-token');
  const [connecting, setConnecting] = React.useState(false);
  const [error, setError] = React.useState('');

  const submit = (e) => {
    e.preventDefault();
    setError('');
    setConnecting(true);
    setTimeout(() => {
      if (token.trim().length < 4) {
        setConnecting(false);
        setError('Token rejected. Check it and try again.');
      } else {
        onConnect(host);
      }
    }, 850);
  };

  return (
    <div style={{
      minHeight: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--surface-app)', position: 'relative',
    }}>
      {/* faint dotted texture in the corner */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.5,
        backgroundImage: 'radial-gradient(var(--border-subtle) 1px, transparent 1px)',
        backgroundSize: '22px 22px', maskImage: 'radial-gradient(circle at 50% 38%, #000, transparent 60%)',
        WebkitMaskImage: 'radial-gradient(circle at 50% 38%, #000, transparent 60%)',
      }} />
      <div style={{ position: 'absolute', top: 'var(--space-5)', right: 'var(--space-5)' }}>
        <button onClick={onToggleTheme} aria-label="Toggle theme" style={{
          width: 36, height: 36, display: 'grid', placeItems: 'center', cursor: 'pointer',
          background: 'transparent', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)', color: 'var(--text-muted)',
        }}>{theme === 'dark' ? <window.SunIcon/> : <window.MoonIcon/>}</button>
      </div>

      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 'var(--space-6)', position: 'relative' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
            <window.BrandLogo size={40} showWord={false} />
            <div style={{ textAlign: 'center' }}>
              <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 6 }}>Connect to your relay</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-base)' }}>
                Reach the <code style={{ color: 'var(--text-accent)' }}>node-pty</code> sessions running on your machine.
              </p>
            </div>
          </div>

          <form onSubmit={submit} style={{
            display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
            background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-xl)', padding: 'var(--space-6)', boxShadow: 'var(--shadow-md)',
          }}>
            <Input label="Relay host" mono prefix={<window.ServerIcon size={16}/>}
                   value={host} onChange={e => setHost(e.target.value)} placeholder="main.local:7070" />
            <Input label="Access token" type="password" mono prefix={<window.KeyIcon size={16}/>}
                   value={token} onChange={e => setToken(e.target.value)}
                   placeholder="paste relay token" error={error}
                   hint={error ? '' : 'Found in the relay daemon logs on first run.'} />
            <Button type="submit" fullWidth loading={connecting}
                    leadingIcon={connecting ? null : <window.PlugIcon size={16}/>}>
              {connecting ? 'Connecting…' : 'Connect'}
            </Button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 'var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--text-faint)' }}>
            Relay not running? <a href="#" onClick={e => e.preventDefault()}>Start the daemon</a>
          </p>
        </div>
      </div>
    </div>
  );
}

window.LoginScreen = LoginScreen;
