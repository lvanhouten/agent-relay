const pty = require('node-pty');
const { randomUUID } = require('crypto');
const { EventEmitter } = require('events');
const os = require('os');

const DEFAULT_SHELL = process.platform === 'win32'
  ? 'powershell.exe'
  : (process.env.SHELL ?? 'bash');

class SessionManager extends EventEmitter {
  constructor() {
    super();
    this._sessions = new Map();
  }

  spawn({ name, cwd, shell, command } = {}) {
    const id = randomUUID();
    const exe = command ?? shell ?? DEFAULT_SHELL;
    const wd = cwd ?? os.homedir();

    const proc = pty.spawn(exe, [], {
      name: 'xterm-256color',
      cols: 220,
      rows: 50,
      cwd: wd,
      env: process.env,
    });

    const session = {
      id,
      name: (name ?? '').trim() || `session-${this._sessions.size + 1}`,
      shell: exe,
      cwd: wd,
      pid: proc.pid,
      status: 'online',
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
      scrollback: [],
      proc,
    };

    proc.onData((data) => {
      session.lastActiveAt = Date.now();
      session.scrollback.push(data);
      if (session.scrollback.length > 1000) session.scrollback.shift();
      this.emit('data', id, data);
    });

    proc.onExit(({ exitCode }) => {
      session.status = 'offline';
      this.emit('exit', id, exitCode);
    });

    this._sessions.set(id, session);
    return this._dto(session);
  }

  write(id, data) {
    const s = this._sessions.get(id);
    if (!s || s.status === 'offline') return false;
    s.proc.write(data);
    return true;
  }

  resize(id, cols, rows) {
    const s = this._sessions.get(id);
    if (s && s.status !== 'offline') s.proc.resize(cols, rows);
  }

  kill(id) {
    const s = this._sessions.get(id);
    if (!s) return false;
    try { s.proc.kill(); } catch { /* already dead */ }
    this._sessions.delete(id);
    return true;
  }

  get(id) {
    const s = this._sessions.get(id);
    return s ? this._dto(s) : null;
  }

  list() {
    return [...this._sessions.values()].map((s) => this._dto(s));
  }

  scrollback(id) {
    return this._sessions.get(id)?.scrollback ?? [];
  }

  _dto(s) {
    const idle = (Date.now() - s.lastActiveAt) / 1000;
    const lastActive =
      idle < 60  ? `${Math.round(idle)}s ago`
      : idle < 3600 ? `${Math.round(idle / 60)}m ago`
      : `${Math.round(idle / 3600)}h ago`;
    return {
      id: s.id,
      name: s.name,
      shell: s.shell,
      cwd: s.cwd,
      pid: s.pid,
      status: s.status,
      lastActive,
    };
  }
}

module.exports = { SessionManager };
