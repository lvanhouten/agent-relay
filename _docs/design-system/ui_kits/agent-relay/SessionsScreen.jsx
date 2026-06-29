// agent-relay · Sessions screen — pick a live session or start a new one.
const { Button, Card, Badge, StatusDot, IconButton, Input, Switch } = window.AgentRelayDesignSystem_9f29b7;

const SHELLS = ['zsh', 'bash', 'fish'];

const PREVIEW_LINE = {
  cmd:  (t) => <span style={{ color: 'var(--terminal-fg)' }}><span style={{ color: 'var(--terminal-accent)' }}>›</span> {t}</span>,
  tool: (t) => <span style={{ color: 'var(--terminal-path)' }}>{t}</span>,
  out:  (t) => <span style={{ color: 'var(--terminal-fg)', opacity: 0.7 }}>{t}</span>,
  ok:   (t) => <span style={{ color: 'var(--relay-500)' }}>{t}</span>,
  live: (t) => (
    <span style={{ color: 'var(--terminal-dim)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span className="rl-term-cursor" /> {t}
    </span>
  ),
};

function TerminalPreview({ lines = [] }) {
  return (
    <div style={{
      background: 'var(--terminal-bg)', borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-subtle)', padding: '10px 12px',
      fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', lineHeight: 1.65,
      height: 92, overflow: 'hidden', position: 'relative',
    }}>
      {lines.map((l, i) => (
        <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {(PREVIEW_LINE[l.t] || PREVIEW_LINE.out)(l.text)}
        </div>
      ))}
    </div>
  );
}

function SessionCard({ s, onAttach, onKill }) {
  return (
    <Card interactive padding="md" onClick={() => onAttach(s)}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-lg)', color: 'var(--text-strong)' }}>
            <StatusDot status={s.status} size="sm" showLabel={false} />
            {s.name}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <window.FolderIcon size={13}/> {s.cwd}
          </span>
        </div>
        <IconButton label="Terminate" size="sm" onClick={(e) => { e.stopPropagation(); onKill(s.id); }}>
          <window.TrashIcon size={15}/>
        </IconButton>
      </div>

      <TerminalPreview lines={s.preview} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge variant="accent">{s.shell}</Badge>
          <Badge variant="neutral">pid {s.pid}</Badge>
          {s.panes > 1 && <Badge variant="outline">{s.panes} panes</Badge>}
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text-faint)', flexShrink: 0 }}>
          <window.ClockIcon size={12}/> {s.lastActive}
        </span>
      </div>
    </Card>
  );
}

function NewSessionDialog({ onClose, onCreate }) {
  const [name, setName] = React.useState('');
  const [cwd, setCwd] = React.useState('~/');
  const [shell, setShell] = React.useState('zsh');

  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 40, display: 'grid', placeItems: 'center',
      background: 'var(--surface-overlay)', backdropFilter: 'blur(2px)', padding: 'var(--space-6)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 420, background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-pop)', padding: 'var(--space-6)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 'var(--text-xl)' }}>New session</h2>
          <IconButton label="Close" size="sm" onClick={onClose}><window.XIcon size={16}/></IconButton>
        </div>
        <Input label="Session name" value={name} onChange={e => setName(e.target.value)} placeholder="api-dev" autoFocus />
        <Input label="Working directory" mono value={cwd} onChange={e => setCwd(e.target.value)} prefix={<window.FolderIcon size={15}/>} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <span className="relay-label">Shell</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {SHELLS.map(sh => (
              <button key={sh} onClick={() => setShell(sh)} style={{
                flex: 1, height: 36, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)',
                borderRadius: 'var(--radius-md)', border: '1px solid ' + (shell === sh ? 'var(--border-accent)' : 'var(--border-default)'),
                background: shell === sh ? 'var(--accent-soft)' : 'var(--surface-card)',
                color: shell === sh ? 'var(--text-accent)' : 'var(--text-body)',
              }}>{sh}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-1)' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button fullWidth leadingIcon={<window.TerminalIcon size={16}/>}
                  onClick={() => onCreate({ name: name.trim() || 'untitled', cwd, shell })}>
            Create &amp; attach
          </Button>
        </div>
      </div>
    </div>
  );
}

function SessionsScreen({ host, sessions, onAttach, onKill, onCreate, theme, onToggleTheme }) {
  const [query, setQuery] = React.useState('');
  const [dialog, setDialog] = React.useState(false);

  const filtered = sessions.filter(s =>
    (s.name + ' ' + s.cwd).toLowerCase().includes(query.toLowerCase()));

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface-app)', position: 'relative' }}>
      <window.TopBar host={host} theme={theme} onToggleTheme={onToggleTheme}
        right={<IconButton label="Settings"><window.SettingsIcon/></IconButton>} />

      <main style={{ flex: 1, width: '100%', maxWidth: 'var(--container-w)', margin: '0 auto', padding: 'var(--space-8) var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-6)' }}>
          <div>
            <span className="relay-label">Active sessions</span>
            <h1 style={{ fontSize: 'var(--text-3xl)', marginTop: 6 }}>
              {sessions.length} session{sessions.length === 1 ? '' : 's'} on <span style={{ color: 'var(--text-accent)' }}>main</span>
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <div style={{ width: 220 }}>
              <Input prefix={<window.SearchIcon size={15}/>} placeholder="Filter sessions"
                     value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <Button leadingIcon={<window.PlusIcon size={16}/>} onClick={() => setDialog(true)}>New session</Button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-20) 0', color: 'var(--text-muted)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>No sessions match “{query}”.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
            {filtered.map(s => <SessionCard key={s.id} s={s} onAttach={onAttach} onKill={onKill} />)}
          </div>
        )}
      </main>

      {dialog && <NewSessionDialog onClose={() => setDialog(false)} onCreate={(d) => { setDialog(false); onCreate(d); }} />}
    </div>
  );
}

window.SessionsScreen = SessionsScreen;
