// Shared brand chrome for the agent-relay UI kit: BrandLogo + TopBar.
const { IconButton } = window.AgentRelayDesignSystem_9f29b7;

function BrandLogo({ size = 24, showWord = true }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--text-strong)' }}>
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="24" cy="24" r="4.5" fill="var(--accent)"/>
        <path d="M13 31.5 A 12 12 0 0 1 13 16.5" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"/>
        <path d="M35 16.5 A 12 12 0 0 1 35 31.5" stroke="var(--relay-300)" strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.85"/>
      </svg>
      {showWord && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>
          agent<span style={{ fontWeight: 400, opacity: 0.5 }}>-relay</span>
        </span>
      )}
    </span>
  );
}

function TopBar({ host, theme, onToggleTheme, right }) {
  return (
    <header style={{
      height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
      padding: '0 var(--space-5)', background: 'var(--surface-card)',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <BrandLogo />
      {host && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'var(--space-3)',
          paddingLeft: 'var(--space-4)', borderLeft: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--status-online)' }} />
          {host}
        </span>
      )}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {right}
        <IconButton label="Toggle theme" onClick={onToggleTheme}>
          {theme === 'dark' ? <window.SunIcon/> : <window.MoonIcon/>}
        </IconButton>
      </div>
    </header>
  );
}

Object.assign(window, { BrandLogo, TopBar });
