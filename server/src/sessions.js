'use strict';
// Board-backed session store. Presents the same surface the API + WS hub already
// consumed from the old in-process SessionManager, but every operation now goes
// through the board kernel (board-client) over its pipes. The web tier holds no
// PTY state, so it can restart without dropping a single session — and sessions
// are shared with the `sb` CLI / terminal panes.
const os = require('os');
const path = require('path');
const { rpc, attach, DEFAULT_IDLE_MS } = require('./board-client');

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
// status is the attention state: 'running' (output within the shared idle
// threshold) or 'idle' (quiet beyond it — deliberately NOT "done": an idle
// agent may be thinking, blocked on a prompt, or finished, and PTY bytes can't
// tell those apart). The threshold is wait.js's DEFAULT_IDLE_MS so the card,
// `sb wait`, and switchboard_wait_for_idle can't disagree about what idle
// means. Tombstones map via endedToDto, which overrides to 'exited'. A missing
// idleMs (older board, or the `new` reply) counts as 0 — just active.
function toDto(line) {
  return {
    id: line.id,
    name: line.name || `session-${line.id}`,
    shell: line.shell,
    cwd: line.cwd,
    pid: line.pid ?? null,
    status: (line.idleMs ?? 0) < DEFAULT_IDLE_MS ? 'running' : 'idle',
    lastActive: relTime(line.idleMs ?? 0),
  };
}

// board tombstone -> exited-session DTO. Built THROUGH toDto (not a parallel
// field list) so a field added to the base session shape lands in both
// producers; only the exit metadata (exitCode, reason) and the dead-process
// overrides (pid, status, endedAt-based lastActive) differ. `reason: 'killed'`
// means the board's `end` command (an operator kill) rather than the process
// exiting on its own.
function endedToDto(t) {
  return {
    ...toDto({ id: t.id, name: t.name, shell: t.shell, cwd: t.cwd }),
    pid: null,
    status: 'exited',
    exitCode: t.exitCode ?? null,
    reason: t.reason === 'killed' ? 'killed' : 'exited',
    lastActive: relTime(Date.now() - (t.endedAt ?? Date.now())),
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
  // rpc/attach are injectable (defaults = the real board-client) so the board-down
  // classification can be unit-tested without a live board.
  constructor({ rpc: rpcFn = rpc, attach: attachFn = attach } = {}) {
    this._rpc = rpcFn;
    this._attach = attachFn;
  }

  async list() {
    let r;
    try {
      r = await this._rpc({ cmd: 'list' });
    } catch (e) {
      console.error('[sessions] board list RPC failed:', e.message);
      throw new BoardUnreachableError(e);
    }
    if (!r || !r.ok) {
      console.error('[sessions] board list RPC returned a non-ok reply:', JSON.stringify(r));
      throw new BoardUnreachableError();
    }
    // Live lines first, then recently-ended tombstones (`ended` is absent from
    // an older board's reply — treat that as none, not an error).
    return [...r.lines.map(toDto), ...(r.ended || []).map(endedToDto)];
  }

  async get(id) {
    return (await this.list()).find(s => s.id === id) || null;
  }

  async spawn({ name, cwd, shell, command } = {}) {
    const wd = resolveCwd(cwd);
    let r;
    try {
      r = await this._rpc({
        cmd: 'new',
        open: false,                            // the browser is the "pane" — no terminal
        name: (name ?? '').trim(),
        shell: shell || undefined,              // which interactive shell; undefined -> board default
        run: (command ?? '').trim() || undefined, // initial command typed into the shell; it stays open
        cwd: wd,
      });
    } catch (e) {
      // Same board-down contract as list()/get(): a spawn against a down board is
      // a transient 503, not a 500. Without this, api.js's e.boardUnreachable
      // check doesn't recognize the bare Error and POST /sessions 500s.
      console.error('[sessions] board new RPC failed:', e.message);
      throw new BoardUnreachableError(e);
    }
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
    // Distinguish "board unreachable" (throw -> 503) from "board says no such
    // line" (return false -> 404). The old `.catch(() => null)` collapsed a
    // board-down failure into `false`, which api.js maps to a permanent 404 —
    // "down looks indistinguishable from gone", the exact C2 bug relocated here.
    let r;
    try {
      r = await this._rpc({ cmd: 'end', id });
    } catch (e) {
      console.error('[sessions] board end RPC failed:', e.message);
      throw new BoardUnreachableError(e);
    }
    if (r && r.ok) return true;
    // Not a live line — maybe a tombstone: DELETE on an exited session is the
    // client dismissing it. `forget` says ok:false for an unknown id (and an
    // older board answers unknown-cmd ok:false), so both still map to 404.
    let f;
    try {
      f = await this._rpc({ cmd: 'forget', id });
    } catch (e) {
      console.error('[sessions] board forget RPC failed:', e.message);
      throw new BoardUnreachableError(e);
    }
    return !!(f && f.ok);
  }

  // Per-WS attach: returns { write, resize, detach }. Scrollback replays on connect.
  attach(id, handlers) {
    return this._attach(id, handlers);
  }
}

module.exports = { BoardSessions, BoardUnreachableError };
