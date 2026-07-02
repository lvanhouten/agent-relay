import React from 'react';
import { Button } from '@ds/Button.jsx';
import { Card } from '@ds/Card.jsx';
import { Badge } from '@ds/Badge.jsx';
import { StatusDot } from '@ds/StatusDot.jsx';
import { IconButton } from '@ds/IconButton.jsx';
import { Input } from '@ds/Input.jsx';
import { listSessions, createSession, killSession } from '../api.js';
import { Terminal, Folder, Clock, Trash2, Plus, Search, Settings, Sun, Moon } from 'lucide-react';

const QUICK_COMMANDS = ['claude', 'bash', 'zsh', 'powershell'];

// NOTE: the per-card scrollback preview was removed here — the server DTO never
// carried a `preview` field (neither toDto() nor spawn() in server/src/sessions.js
// populate one), so the widget rendered a permanent "no output yet" placeholder.
// The data does exist one layer down (the board keeps a 2000-chunk scrollback per
// line), so this can be revived by exposing a scrollback tail through the board's
// `list` reply and threading it into toDto(). Deferred as a feature, not a bug —
// see _docs/issues/2026-07-01-session-card-live-preview.md.

function SessionCard({ session, onAttach, onKill }) {
  const shellLabel = session.shell.split(/[/\\]/).pop();
  return (
    <Card interactive padding="md" onClick={() => onAttach(session)}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontFamily: 'var(--font-display)', fontWeight: 600,
            fontSize: 'var(--text-lg)', color: 'var(--text-strong)',
          }}>
            <StatusDot status={session.status} size="sm" showLabel={false} />
            {session.name}
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            <Folder size={12} /> {session.cwd}
          </span>
        </div>
        <IconButton label="Terminate" size="sm" onClick={(e) => { e.stopPropagation(); onKill(session.id); }}>
          <Trash2 size={14} />
        </IconButton>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Badge variant="accent">{shellLabel}</Badge>
          <Badge variant="neutral">pid {session.pid}</Badge>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)',
          color: 'var(--text-faint)', flexShrink: 0,
        }}>
          <Clock size={11} /> {session.lastActive}
        </span>
      </div>
    </Card>
  );
}

function NewSessionDialog({ onClose, onCreate, error, busy }) {
  const [name, setName] = React.useState('');
  const [cwd, setCwd] = React.useState('~/');
  const [command, setCommand] = React.useState('claude');

  const handleCreate = () => {
    onCreate({
      name: name.trim() || 'untitled',
      cwd,
      command: command.trim() || undefined, // optional; runs in the shell, which stays open
    });
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 40, display: 'grid', placeItems: 'center',
      background: 'var(--surface-overlay)', backdropFilter: 'blur(2px)', padding: 'var(--space-6)',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 420, background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-pop)', padding: 'var(--space-6)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 'var(--text-xl)', margin: 0, color: 'var(--text-strong)' }}>New session</h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <span style={{ fontSize: 18, lineHeight: 1, color: 'var(--text-muted)' }}>×</span>
          </IconButton>
        </div>

        <Input
          label="Session name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="api-dev"
          autoFocus
        />
        <Input
          label="Working directory"
          mono
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          prefix={<Folder size={14} />}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
            textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)',
          }}>
            Initial command
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {QUICK_COMMANDS.map((c) => (
              <button key={c} onClick={() => setCommand(c)} style={{
                flex: 1, height: 36, cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${command === c ? 'var(--border-accent)' : 'var(--border-default)'}`,
                background: command === c ? 'var(--accent-soft)' : 'var(--surface-card)',
                color: command === c ? 'var(--text-accent)' : 'var(--text-body)',
              }}>
                {c}
              </button>
            ))}
          </div>
          <Input
            mono
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npm run dev — leave blank for a plain shell"
          />
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text-faint)',
          }}>
            Runs on start; the shell stays open when it exits.
          </span>
        </div>

        {error && (
          <p style={{
            color: 'var(--danger)', fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-sm)', margin: 0,
          }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-1)' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button fullWidth loading={busy} leadingIcon={<Terminal size={15} />} onClick={handleCreate}>
            Create &amp; attach
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SessionsScreen({ host, token, theme, onToggleTheme, onAttach }) {
  const [sessions, setSessions] = React.useState([]);
  const [query, setQuery] = React.useState('');
  const [dialog, setDialog] = React.useState(false);
  const [createError, setCreateError] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  // Sequence guard so overlapping load()s (a slow poll interleaving with a fresh
  // one) can't let an older response stomp a newer one, and a set of ids killed
  // locally but possibly still present in an in-flight poll's stale list, so a
  // just-killed session can't flicker back for a poll cycle. Refs, not state — we
  // never render off them and don't want them to retrigger the effect.
  const loadSeq = React.useRef(0);
  const latestApplied = React.useRef(0);
  const killed = React.useRef(new Set());

  const load = React.useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const list = await listSessions(token);
      // Drop a stale response: a newer load() already applied its result.
      if (seq < latestApplied.current) return;
      latestApplied.current = seq;
      setSessions(list.filter((s) => !killed.current.has(s.id)));
    } catch { /* offline — keep stale list */ }
  }, [token]);

  React.useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const creatingRef = React.useRef(false);
  const handleCreate = async (opts) => {
    // Synchronous re-entrancy guard: the Button's `disabled` attribute only takes
    // effect after React commits the `creating` state, so a fast double-click
    // before that re-render would otherwise fire two concurrent createSession
    // calls (W4). A ref flips immediately, closing that window.
    if (creatingRef.current) return;
    creatingRef.current = true;
    // Keep the dialog open until the create actually succeeds — createSession
    // throws on any non-ok response (expired token, 500, network drop); closing
    // first would drop that failure into an unhandled rejection with no feedback.
    setCreateError('');
    setCreating(true);
    try {
      const session = await createSession(opts, token);
      setDialog(false);
      onAttach(session);
    } catch {
      setCreateError('Could not create the session. Check the server and try again.');
    } finally {
      setCreating(false);
      creatingRef.current = false;
    }
  };

  const openDialog = () => { setCreateError(''); setDialog(true); };

  // Per-id re-entrancy guard (W2): a fast double-click on the same Terminate
  // button before React commits any state fires two concurrent killSession
  // calls otherwise. A Set (not a single ref) because killing two *different*
  // sessions concurrently is fine — only a repeat click on the same id blocks.
  const killingRef = React.useRef(new Set());
  const handleKill = async (id) => {
    if (killingRef.current.has(id)) return;
    killingRef.current.add(id);
    // Mark before the request so any poll response that resolves during the kill
    // (and still lists this id from a stale board snapshot) is filtered out — no
    // flicker-back. Remove the mark once we've confirmed it's gone from a fresh
    // list, so a future reused id isn't permanently hidden.
    killed.current.add(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    try {
      await killSession(id, token);
    } finally {
      // Reconcile against a fresh list, then stop suppressing the id.
      await load();
      killed.current.delete(id);
      killingRef.current.delete(id);
    }
  };

  const filtered = sessions.filter((s) =>
    `${s.name} ${s.cwd}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface-app)' }}>
      <header style={{
        height: 52, flexShrink: 0, display: 'flex', alignItems: 'center',
        padding: '0 var(--space-5)', gap: 'var(--space-3)',
        background: 'var(--surface-card)', borderBottom: '1px solid var(--border-subtle)',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontWeight: 700,
          fontSize: 'var(--text-base)', color: 'var(--text-strong)',
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            width: 22, height: 22, borderRadius: 4, background: 'var(--accent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: 'var(--text-on-accent)',
          }}>▸</span>
          agent-relay
        </span>
        <span style={{ flex: 1 }} />
        <IconButton label="Toggle theme" onClick={onToggleTheme}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
        <IconButton label="Settings"><Settings size={16} /></IconButton>
      </header>

      <main style={{
        flex: 1, width: '100%', maxWidth: 'var(--container-w)',
        margin: '0 auto', padding: 'var(--space-8) var(--space-6)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-6)',
        }}>
          <div>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
              textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-muted)',
            }}>
              Active sessions
            </span>
            <h1 style={{ fontSize: 'var(--text-3xl)', margin: '6px 0 0', color: 'var(--text-strong)' }}>
              {sessions.length} session{sessions.length === 1 ? '' : 's'} on{' '}
              <span style={{ color: 'var(--text-accent)' }}>main</span>
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <div style={{ width: 200 }}>
              <Input
                prefix={<Search size={14} />}
                placeholder="Filter sessions"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button leadingIcon={<Plus size={15} />} onClick={openDialog}>
              New session
            </Button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-20) 0', color: 'var(--text-muted)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
              {sessions.length === 0
                ? 'No sessions yet. Start one to get going.'
                : `No sessions match "${query}".`}
            </div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 'var(--space-4)',
          }}>
            {filtered.map((s) => (
              <SessionCard key={s.id} session={s} onAttach={onAttach} onKill={handleKill} />
            ))}
          </div>
        )}
      </main>

      {dialog && (
        <NewSessionDialog
          onClose={() => setDialog(false)}
          onCreate={handleCreate}
          error={createError}
          busy={creating}
        />
      )}
    </div>
  );
}
