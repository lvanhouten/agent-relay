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
    pid: line.pid ?? null,
    status: 'online',                          // the board only lists live lines
    lastActive: relTime(line.idleMs ?? 0),
  };
}

// A board RPC failed (board down, pipe error, malformed reply). Distinct from an
// empty session list so callers can tell "board unreachable" from "zero sessions":
// the API answers 503 (not 200 []), and the WS hub closes with a "board
// unreachable" reason (not "session not found") — otherwise every live session
// looks dead during any transient board hiccup.
class BoardUnreachableError extends Error {
  constructor(cause) {
    super('board unreachable');
    this.name = 'BoardUnreachableError';
    this.boardUnreachable = true;
    if (cause) this.cause = cause;
  }
}

class BoardSessions {
  async list() {
    let r;
    try {
      r = await rpc({ cmd: 'list' });
    } catch (e) {
      console.error('[sessions] board list RPC failed:', e.message);
      throw new BoardUnreachableError(e);
    }
    if (!r || !r.ok) {
      console.error('[sessions] board list RPC returned a non-ok reply:', JSON.stringify(r));
      throw new BoardUnreachableError();
    }
    return r.lines.map(toDto);
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
    // Build the DTO through the same toDto() the list path uses, off the board's
    // own `new` reply, so the shape can't drift between the two call sites and the
    // reported cwd is the value the board actually recorded — not our local
    // resolveCwd() guess. `wd` is the fallback for an older board that doesn't echo
    // cwd; idleMs is 0 (just spawned).
    return {
      ...toDto({ id: r.id, name: r.name, shell: r.shell, cwd: r.cwd ?? wd, pid: r.pid, idleMs: 0 }),
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

module.exports = { BoardSessions, BoardUnreachableError };
