import React from 'react';
import { Button } from '@ds/Button.jsx';
import { Card } from '@ds/Card.jsx';
import { Badge } from '@ds/Badge.jsx';
import { StatusDot } from '@ds/StatusDot.jsx';
import { IconButton } from '@ds/IconButton.jsx';
import { Input } from '@ds/Input.jsx';
import { useSessions } from '../core/useSessions.ts';
import { isClaudeCommand, getFlag, setFlag } from '../core/claudeFlags.ts';
import { Terminal, Folder, Clock, Trash2, Plus, Search, Settings, Sun, Moon, X, ChevronRight, ChevronDown } from 'lucide-react';

const QUICK_COMMANDS = ['claude', 'bash', 'zsh', 'powershell'];

// Suggestions, not validation: the command field stays the escape hatch for any
// model/effort name these chips don't know — the CLI is the validator, and a
// hardcoded list must never refuse what the CLI would accept (see
// _docs/issues/2026-07-02-claude-model-effort-selection.md).
const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku', 'fable'];
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Operator-wide defaults for Claude sessions: last-used values persist on a
// successful spawn (no separate settings UI) and prefill the next claude
// command. localStorage for now; migrates into the server-side store when
// spawn-templates phase 2 lands so the two share one persistence story.
function withClaudeDefaults(cmd) {
  const model = localStorage.getItem('ar-claude-model');
  const effort = localStorage.getItem('ar-claude-effort');
  let out = cmd;
  if (model) out = setFlag(out, 'model', model);
  if (effort) out = setFlag(out, 'effort', effort);
  return out;
}

function rememberClaudeDefaults(command) {
  // Only a claude spawn updates the defaults — launching bash must not clear
  // them. A claude spawn with a flag omitted *does* clear that default: the
  // operator chose the CLI default, so remember the choice.
  if (!isClaudeCommand(command)) return;
  const model = getFlag(command, 'model');
  const effort = getFlag(command, 'effort');
  if (model) localStorage.setItem('ar-claude-model', model);
  else localStorage.removeItem('ar-claude-model');
  if (effort) localStorage.setItem('ar-claude-effort', effort);
  else localStorage.removeItem('ar-claude-effort');
}

// One row of flag chips — a structured editor over the command string. A chip
// click splices only its own flag (setFlag), so hand-typed text elsewhere in
// the command survives; "default" removes the flag (CLI config decides).
function FlagChipRow({ label, flag, options, command, onCommand }) {
  const current = getFlag(command, flag);
  const chips = [{ value: null, text: 'default' }, ...options.map((o) => ({ value: o, text: o }))];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)',
        color: 'var(--text-muted)', width: 46, flexShrink: 0,
      }}>
        {label}
      </span>
      {chips.map(({ value, text }) => {
        const selected = current === value;
        return (
          <button key={text} onClick={() => onCommand(setFlag(command, flag, value))} style={{
            flex: 1, height: 26, cursor: 'pointer', minWidth: 0,
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${selected ? 'var(--border-accent)' : 'var(--border-default)'}`,
            background: selected ? 'var(--accent-soft)' : 'var(--surface-card)',
            color: selected ? 'var(--text-accent)' : 'var(--text-body)',
          }}>
            {text}
          </button>
        );
      })}
    </div>
  );
}

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

// A tombstone card: the board keeps a capped ring of recently-ended lines so an
// unattended exit doesn't just vanish from the poll. Not attachable (the data
// pipe is gone) — the only action is dismiss, which drops the tombstone via the
// same DELETE the kill button uses (the server falls through to `forget`).
function ExitedSessionCard({ session, onDismiss }) {
  const shellLabel = session.shell.split(/[/\\]/).pop();
  const killed = session.reason === 'killed';
  const label = killed ? 'killed' : `exit ${session.exitCode ?? '?'}`;
  // The one crash predicate — dot color and badge variant must agree. A kill is
  // expected, a clean exit is fine, and an UNKNOWN (null) exit code is not
  // presented as a crash: only a known non-zero code earns the error styling.
  const failed = !killed && session.exitCode != null && session.exitCode !== 0;
  return (
    <Card padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', opacity: 0.75 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontFamily: 'var(--font-display)', fontWeight: 600,
            fontSize: 'var(--text-lg)', color: 'var(--text-strong)',
          }}>
            <StatusDot status={failed ? 'error' : 'offline'} pulse={false} size="sm" showLabel={false} />
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
        <IconButton label="Dismiss" size="sm" onClick={() => onDismiss(session.id)}>
          <X size={14} />
        </IconButton>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Badge variant="neutral">{shellLabel}</Badge>
          <Badge variant={failed ? 'danger' : 'neutral'}>{label}</Badge>
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
  const [command, setCommand] = React.useState(() => withClaudeDefaults('claude'));

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
            {QUICK_COMMANDS.map((c) => {
              // The claude chip stays lit while flags ride the command — the
              // model/effort chips below edit the same string. Re-clicking it
              // while lit is a no-op: a hand-built claude command (flags, a
              // quoted prompt) must not be wiped by a "make sure it's
              // selected" click on an already-selected control.
              const selected = c === 'claude' ? isClaudeCommand(command) : command === c;
              const pick = () => {
                if (selected) return;
                setCommand(c === 'claude' ? withClaudeDefaults('claude') : c);
              };
              return (
                <button key={c} onClick={pick} style={{
                  flex: 1, height: 36, cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${selected ? 'var(--border-accent)' : 'var(--border-default)'}`,
                  background: selected ? 'var(--accent-soft)' : 'var(--surface-card)',
                  color: selected ? 'var(--text-accent)' : 'var(--text-body)',
                }}>
                  {c}
                </button>
              );
            })}
          </div>
          {isClaudeCommand(command) && (
            <>
              <FlagChipRow label="model" flag="model" options={CLAUDE_MODELS} command={command} onCommand={setCommand} />
              <FlagChipRow label="effort" flag="effort" options={CLAUDE_EFFORTS} command={command} onCommand={setCommand} />
            </>
          )}
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
  // Data layer — list + poll + create/kill with their concurrency guards —
  // lives in core/useSessions. This screen owns only presentation state.
  const { sessions, create, kill, creating } = useSessions(token);
  const [query, setQuery] = React.useState('');
  const [dialog, setDialog] = React.useState(false);
  const [createError, setCreateError] = React.useState('');

  const handleCreate = async (opts) => {
    // Keep the dialog open until the create actually succeeds — create()
    // rejects on any non-ok response (expired token, 500, network drop); closing
    // first would drop that failure into an unhandled rejection with no feedback.
    //
    // create()'s re-entrancy guard (W4) lives inside the hook, so a double-click's
    // second call no-ops *after* this line: anything placed before the
    // `if (!session)` check below runs on dropped calls too. Today that's only
    // this error clear (harmless — the first click just cleared it); keep any
    // future side effect (analytics, optimistic mutation) below the null check.
    setCreateError('');
    try {
      const session = await create(opts);
      if (!session) return; // dropped by the re-entrancy guard — the first click is still in flight
      rememberClaudeDefaults(opts.command ?? '');
      setDialog(false);
      onAttach(session);
    } catch {
      setCreateError('Could not create the session. Check the server and try again.');
    }
  };

  const openDialog = () => { setCreateError(''); setDialog(true); };
  const [showEnded, setShowEnded] = React.useState(false);

  const filtered = sessions.filter((s) =>
    `${s.name} ${s.cwd}`.toLowerCase().includes(query.toLowerCase())
  );
  // The list carries live sessions and recently-ended tombstones in one array
  // (both come from GET /sessions); the tombstones render in their own
  // collapsed section, and the header count stays live-only.
  const live = filtered.filter((s) => s.status !== 'exited');
  const ended = filtered.filter((s) => s.status === 'exited');
  const liveCount = sessions.filter((s) => s.status !== 'exited').length;

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
              {liveCount} session{liveCount === 1 ? '' : 's'} on{' '}
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

        {live.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-20) 0', color: 'var(--text-muted)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
              {liveCount === 0
                ? 'No active sessions. Start one to get going.'
                : `No sessions match "${query}".`}
            </div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 'var(--space-4)',
          }}>
            {live.map((s) => (
              <SessionCard key={s.id} session={s} onAttach={onAttach} onKill={kill} />
            ))}
          </div>
        )}

        {ended.length > 0 && (
          <section style={{ marginTop: 'var(--space-8)' }}>
            <button onClick={() => setShowEnded((v) => !v)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
              textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-muted)',
            }}>
              {showEnded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Recently exited ({ended.length})
            </button>
            {showEnded && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 'var(--space-4)',
                marginTop: 'var(--space-4)',
              }}>
                {ended.map((s) => (
                  <ExitedSessionCard key={s.id} session={s} onDismiss={kill} />
                ))}
              </div>
            )}
          </section>
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
