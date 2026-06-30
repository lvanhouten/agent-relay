'use strict';
// Board-backed session store. Presents the same surface the API + WS hub already
// consumed from the old in-process SessionManager, but every operation now goes
// through the board kernel (board-client) over its pipes. The web tier holds no
// PTY state, so it can restart without dropping a single session — and sessions
// are shared with the `sb` CLI / terminal panes.
const os = require('os');
const path = require('path');
const { rpc, attach } = require('./board-client');

// Expand a leading ~ and fall back to home. The board hands cwd straight to
// pty.spawn, which throws on a literal "~/".
function resolveCwd(cwd) {
  const raw = (cwd ?? '').trim();
  if (!raw) return os.homedir();
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(1).replace(/^[\\/]/, ''));
  }
  return raw;
}

function relTime(ms) {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// board "line" -> agent-relay session DTO (the shape the client already expects).
function toDto(line) {
  return {
    id: line.id,
    name: line.name || `session-${line.id}`,
    shell: line.shell,
    cwd: line.cwd,
    pid: line.pid,
    status: 'online',                          // the board only lists live lines
    lastActive: relTime(line.idleMs ?? 0),
  };
}

class BoardSessions {
  async list() {
    const r = await rpc({ cmd: 'list' }).catch(() => null);
    return r && r.ok ? r.lines.map(toDto) : [];
  }

  async get(id) {
    return (await this.list()).find(s => s.id === id) || null;
  }

  async spawn({ name, cwd, shell, command } = {}) {
    const wd = resolveCwd(cwd);
    const r = await rpc({
      cmd: 'new',
      open: false,                              // the browser is the "pane" — no terminal
      name: (name ?? '').trim(),
      shell: shell || undefined,                // which interactive shell; undefined -> board default
      run: (command ?? '').trim() || undefined, // initial command typed into the shell; it stays open
      cwd: wd,
    });
    if (!r || !r.ok) throw new Error('board refused spawn');
    return {
      id: r.id,
      name: r.name || `session-${r.id}`,
      shell: r.shell,
      cwd: wd,
      pid: r.pid ?? null,
      status: 'online',
      lastActive: 'just now',
    };
  }

  async kill(id) {
    const r = await rpc({ cmd: 'end', id }).catch(() => null);
    return !!(r && r.ok);
  }

  // Per-WS attach: returns { write, resize, detach }. Scrollback replays on connect.
  attach(id, handlers) {
    return attach(id, handlers);
  }
}

module.exports = { BoardSessions };
