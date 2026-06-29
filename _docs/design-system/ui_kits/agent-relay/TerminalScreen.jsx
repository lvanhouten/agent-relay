// agent-relay · Terminal screen — interactive agent session attached to a pty.
// Renders an agent transcript: tool calls, file results, inline diffs, prose,
// a working indicator, and an input box. Original agent-relay styling.
const { Badge, StatusDot, IconButton, Kbd } = window.AgentRelayDesignSystem_9f29b7;

// ---- transcript line renderers -------------------------------------------

function Dot({ color = 'var(--relay-500)' }) {
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 7 }} />;
}

function ToolLine({ name, arg, result, hint }) {
  return (
    <div style={{ display: 'flex', gap: 9, margin: '14px 0 2px' }}>
      <Dot />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ color: 'var(--terminal-fg)', fontWeight: 700 }}>{name}</span>
          <span style={{ color: 'var(--terminal-dim)' }}>({arg})</span>
        </div>
        {result && (
          <div style={{ color: 'var(--terminal-dim)' }}>
            <span style={{ opacity: 0.6 }}>└ </span>{result}
            {hint && <span style={{ opacity: 0.5 }}> ({hint})</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function SayLine({ text }) {
  // text may contain {path}…{/path} markers for accent-colored paths
  const parts = String(text).split(/(\{path\}.*?\{\/path\})/g).filter(Boolean);
  return (
    <div style={{ display: 'flex', gap: 9, margin: '14px 0' }}>
      <Dot color="var(--terminal-dim)" />
      <p style={{ color: 'var(--terminal-fg)', opacity: 0.92, lineHeight: 1.7, margin: 0 }}>
        {parts.map((p, i) =>
          p.startsWith('{path}')
            ? <span key={i} style={{ color: 'var(--terminal-path)' }}>{p.slice(6, -7)}</span>
            : <React.Fragment key={i}>{p}</React.Fragment>
        )}
      </p>
    </div>
  );
}

function UserLine({ text }) {
  return (
    <div style={{ display: 'flex', gap: 9, margin: '14px 0' }}>
      <span style={{ color: 'var(--terminal-accent)', fontWeight: 700, marginTop: 0 }}>›</span>
      <p style={{ color: 'var(--terminal-fg)', margin: 0 }}>{text}</p>
    </div>
  );
}

function DiffBlock({ file, rows }) {
  return (
    <div style={{ paddingLeft: 16, margin: '4px 0 2px' }}>
      {rows.map((r, i) => {
        const bg = r.type === 'add' ? 'var(--diff-add-bg)' : r.type === 'del' ? 'var(--diff-del-bg)' : 'transparent';
        const fg = r.type === 'add' ? 'var(--diff-add-fg)' : r.type === 'del' ? 'var(--diff-del-fg)' : 'var(--terminal-fg)';
        const sign = r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' ';
        return (
          <div key={i} style={{ display: 'flex', background: bg }}>
            <span style={{ width: 26, textAlign: 'right', color: 'var(--terminal-dim)', opacity: 0.7, flexShrink: 0, paddingRight: 8 }}>{r.n}</span>
            <span style={{ width: 12, color: fg, flexShrink: 0, opacity: r.type === 'ctx' ? 0.4 : 1 }}>{sign}</span>
            <span style={{ color: fg, whiteSpace: 'pre', opacity: r.type === 'ctx' ? 0.8 : 1 }}>{r.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function WorkingLine({ text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '14px 0 4px', color: 'var(--terminal-accent)' }}>
      <span className="rl-term-cursor" style={{ marginTop: 0 }} />
      <span>{text}</span>
    </div>
  );
}

function TranscriptLine({ l }) {
  switch (l.type) {
    case 'tool':    return <ToolLine {...l} />;
    case 'say':     return <SayLine text={l.text} />;
    case 'user':    return <UserLine text={l.text} />;
    case 'diff':    return <DiffBlock file={l.file} rows={l.rows} />;
    case 'working': return <WorkingLine text={l.text} />;
    case 'sys':     return <div style={{ color: 'var(--terminal-accent)', opacity: 0.8, marginBottom: 4 }}>— {l.text}</div>;
    default:        return <div style={{ color: 'var(--terminal-fg)', opacity: 0.8 }}>{l.text}</div>;
  }
}

// ---- canned starting transcript ------------------------------------------

function startTranscript(session) {
  return [
    { type: 'sys', text: `Attached to session "${session.name}" · ${session.shell} · pid ${session.pid}` },
    { type: 'user', text: 'expand the test coverage for the search ranking module' },
    { type: 'say', text: "I'll look at what's there first, then fill the gaps." },
    { type: 'tool', name: 'List', arg: 'src/search', result: 'Listed 12 files', hint: 'ctrl+r to expand' },
    { type: 'tool', name: 'Read', arg: 'src/search/rank.js', result: 'Read 84 lines', hint: 'ctrl+r to expand' },
    { type: 'say', text: 'There are a few ranking tests, but empty-query and tie-break edge cases aren\u2019t covered. I\u2019ll add them in {path}test/rank.test.js{/path}.' },
    { type: 'tool', name: 'Update', arg: 'test/rank.test.js', result: 'Updated with 2 additions and 1 removal' },
    { type: 'diff', file: 'test/rank.test.js', rows: [
      { n: 1,  type: 'ctx', text: "import { rank } from '../src/search/rank.js'" },
      { n: 2,  type: 'del', text: "test('ranks results', () => {" },
      { n: 2,  type: 'add', text: "test('ranks results by score, stable on ties', () => {" },
      { n: 3,  type: 'add', text: "  expect(rank('', docs)).toEqual([])" },
      { n: 4,  type: 'ctx', text: '  expect(rank(q, docs)).toBeSorted()' },
    ] },
    { type: 'working', text: 'running tests\u2026 27s · esc to cancel' },
  ];
}

const REPLY = "On it \u2014 running that against the current branch now.";

function TerminalScreen({ session, host, onBack, theme, onToggleTheme }) {
  const [lines, setLines] = React.useState(() => startTranscript(session));
  const [input, setInput] = React.useState('');
  const viewRef = React.useRef(null);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (viewRef.current) viewRef.current.scrollTop = viewRef.current.scrollHeight;
  }, [lines]);

  const send = () => {
    const t = input.trim();
    if (!t) return;
    if (t === 'clear') { setLines([]); setInput(''); return; }
    setLines(prev => [...prev.filter(l => l.type !== 'working'), { type: 'user', text: t }]);
    setInput('');
    setTimeout(() => setLines(prev => [...prev, { type: 'say', text: REPLY }]), 450);
  };

  const onKey = (e) => { if (e.key === 'Enter') send(); };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface-app)' }}>
      {/* session header */}
      <header style={{
        height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        padding: '0 var(--space-4)', background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)',
      }}>
        <IconButton label="Back to sessions" onClick={onBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </IconButton>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <window.TerminalIcon size={16}/>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--text-strong)' }}>{session.name}</span>
          <Badge variant="accent">{session.shell}</Badge>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{session.cwd}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StatusDot status="online" size="sm" />
          <span style={{ width: 1, height: 22, background: 'var(--border-subtle)', margin: '0 4px' }} />
          <IconButton label="Copy buffer"><window.CopyIcon size={16}/></IconButton>
          <IconButton label="Split pane"><window.SplitIcon size={16}/></IconButton>
          <IconButton label="Fullscreen"><window.MaximizeIcon size={16}/></IconButton>
          <IconButton label="Toggle theme" onClick={onToggleTheme}>{theme === 'dark' ? <window.SunIcon size={16}/> : <window.MoonIcon size={16}/>}</IconButton>
        </div>
      </header>

      {/* terminal canvas */}
      <div ref={viewRef} onClick={() => inputRef.current && inputRef.current.focus()} style={{
        flex: 1, overflowY: 'auto', background: 'var(--terminal-bg)', color: 'var(--terminal-fg)',
        fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', lineHeight: 1.6,
        padding: 'var(--space-5) var(--space-6)', cursor: 'text',
      }}>
        <div style={{ maxWidth: 880 }}>
          {lines.map((l, i) => <TranscriptLine key={i} l={l} />)}
        </div>
      </div>

      {/* fixed input bar */}
      <div style={{
        flexShrink: 0, background: 'var(--terminal-bg)', borderTop: '1px solid var(--terminal-border)',
        padding: 'var(--space-4) var(--space-6) var(--space-3)',
      }}>
        <div style={{ maxWidth: 880 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            border: '1px solid var(--terminal-border)', borderRadius: 'var(--radius-lg)',
            padding: '11px 14px', background: 'var(--surface-card)',
          }}>
            <span style={{ color: 'var(--terminal-accent)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>›</span>
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
              autoFocus spellCheck={false} placeholder="Ask the session to do something…" style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text-strong)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', caretColor: 'var(--terminal-accent)',
              }} />
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, paddingLeft: 4, color: 'var(--terminal-dim)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)' }}>
            <span>enter to send</span>
            <span>⌘K commands</span>
            <span>esc to cancel a run</span>
          </div>
        </div>
      </div>

      {/* status strip */}
      <footer style={{
        height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
        padding: '0 var(--space-5)', background: 'var(--surface-card)', borderTop: '1px solid var(--border-subtle)',
        fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text-faint)',
      }}>
        <span style={{ color: 'var(--text-accent)' }}>● {host}</span>
        <span>utf-8</span>
        <span>{session.shell}</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <Kbd keys={['Ctrl','D']} /> detach
        </span>
      </footer>
    </div>
  );
}

window.TerminalScreen = TerminalScreen;
