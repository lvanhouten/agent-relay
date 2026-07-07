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

// Canonicalize a cwd for equality matching (the /api/notify cwd bridge). A hook
// reports its own absolute cwd; the board records the resolveCwd()'d value passed
// at spawn. Normalize both through path.resolve (collapses separators, trailing
// slashes, and `.`/`..`) and lowercase on Windows, whose filesystem is
// case-insensitive. Returns '' for an empty/whitespace cwd so a blank field can
// never match every home-dir line. Deliberately does NOT expand `~` — a hook's
// cwd is already absolute, and treating a literal '~' as home would over-match.
function normalizeCwdForMatch(cwd) {
  const raw = (cwd ?? '').trim();
  if (!raw) return '';
  const resolved = path.resolve(raw);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
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
// tell those apart). The threshold is wait.js's DEFAULT_IDLE_MS so the card
// and `sb wait` can't disagree about what idle means. Tombstones map via
// endedToDto, which overrides to 'exited'. A missing or non-finite idleMs
// (older board, the `new` reply, or a malformed pipe value) counts as 0 — just
// active. Number.isFinite, not ??: a NaN would compare false into 'idle' and
// render "NaNs ago" on the card.
function toDto(line) {
  const idleMs = Number.isFinite(line.idleMs) ? line.idleMs : 0;
  return {
    id: line.id,
    name: line.name || `session-${line.id}`,
    shell: line.shell,
    cwd: line.cwd,
    pid: line.pid ?? null,
    status: idleMs < DEFAULT_IDLE_MS ? 'running' : 'idle',
    lastActive: relTime(idleMs),
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
  constructor({ rpc: rpcFn = rpc, attach: attachFn = attach, now = Date.now } = {}) {
    this._rpc = rpcFn;
    this._attach = attachFn;
    this._now = now; // injectable clock so the needs-input reconciliation is testable
    // needs-input attention flags: session id -> the wall-clock ms at which a
    // Claude Code Notification hook (via POST /api/notify) reported the line as
    // blocked on a prompt. A web-tier-only Map on purpose — the board owns no
    // notion of "needs input", and putting it here avoids a board restart (which
    // would end every line). Lost on a web-tier restart (a re-fired hook re-flags);
    // that's acceptable per the issue doc's pragmatism.
    this._attention = new Map();
    // The board boot nonce last seen in a list reply — a change means the board
    // restarted and every line id may be reused, so the flags above are void.
    this._boardBoot = null;
  }

  // Mark a live line as needing input. Set unconditionally (no existence RPC —
  // stay dumb); list() prunes flags for ids that aren't live and clears a flag
  // once output/input has moved past it.
  flagAttention(id) {
    if (id) this._attention.set(id, this._now());
  }

  // Flag the live line whose cwd matches `cwd` — the /api/notify fallback for a
  // hook that knows its own directory but not the board line id (the precise
  // bridge is the AGENT_RELAY_SESSION env var the board injects at spawn; this
  // backstops sb-spawned or pre-existing lines the hook can't name). cwd isn't
  // unique, so on a tie the most recently active match (smallest idleMs) wins —
  // over-lighting every same-dir line would be worse than picking the one the
  // operator is most likely staring at. Returns the flagged id, or null when no
  // live line matches (a gone/typo'd cwd just flags nothing). Board-down throws
  // BoardUnreachableError like the other RPC paths (-> 503, not a silent no-op).
  async flagAttentionByCwd(cwd) {
    const target = normalizeCwdForMatch(cwd);
    if (!target) return null;
    let r;
    try {
      r = await this._rpc({ cmd: 'list' });
    } catch (e) {
      console.error('[sessions] board list RPC failed (flagAttentionByCwd):', e.message);
      throw new BoardUnreachableError(e);
    }
    if (!r || !r.ok) throw new BoardUnreachableError();
    const matches = r.lines
      .filter((l) => normalizeCwdForMatch(l.cwd) === target)
      .sort((a, b) => (a.idleMs ?? 0) - (b.idleMs ?? 0)); // most recently active first
    if (!matches.length) return null;
    this.flagAttention(matches[0].id);
    return matches[0].id;
  }

  // Clear a flag explicitly — the WS hub calls this the instant it sees an
  // `input` frame (the operator answered from the web terminal), which is the
  // precise "cleared on next input" signal. The output-based clear in list() is
  // the fallback for input arriving via another attach (e.g. the `sb` pane).
  clearAttention(id) {
    this._attention.delete(id);
  }

  // Overlay the needs-input state onto a live-line DTO. A flag survives only
  // while the line has produced no output since it was set: once the board's
  // idleMs implies output (or input echo) landed AFTER flaggedAt, the agent is
  // moving again, so the flag is stale — drop it and report the normal state.
  //
  // ORDERING ASSUMPTION this rides on: a Claude Code Notification hook fires
  // after the prompt's final paint, so by the time its POST lands here the
  // line's last output PRECEDES flaggedAt and the flag sticks. A laggy hook
  // racing a late TUI repaint (or an attach-triggered resize repaint) would be
  // read as "the agent moved again" and silently clear a flag that should
  // stick — a soft failure (stale card, no corruption). If false-clears show
  // up in practice, add a small grace window (ignore output within ~1s after
  // flaggedAt) rather than loosening the clear entirely.
  _applyAttention(dto, line) {
    const flaggedAt = this._attention.get(dto.id);
    if (flaggedAt == null) return dto;
    const lastOutputAt = this._now() - (line.idleMs ?? 0);
    if (lastOutputAt > flaggedAt) {
      this._attention.delete(dto.id);
      return dto;
    }
    return { ...dto, status: 'needs-input' };
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
    // A board restart resets its line-id counter, so a web tier that outlives
    // the board can hold a flag a REUSED id would inherit (the output-after-
    // flag clear usually self-heals it, but a fresh quiet line would read
    // needs-input). The list reply carries the board's per-process boot nonce —
    // the same signal mcp-server.js namespaces its read cursors by — so drop
    // every flag when it changes.
    if (r.boot !== this._boardBoot) {
      if (this._boardBoot !== null) this._attention.clear();
      this._boardBoot = r.boot;
    }
    // Prune attention flags whose line is no longer live (it exited) so the Map
    // can't leak entries for dead ids or resurrect a flag onto a reused id.
    const liveIds = new Set(r.lines.map((l) => l.id));
    for (const id of this._attention.keys()) if (!liveIds.has(id)) this._attention.delete(id);
    // Live lines first (with the needs-input overlay), then recently-ended
    // tombstones (`ended` is absent from an older board's reply — treat that as
    // none, not an error).
    return [
      ...r.lines.map((line) => this._applyAttention(toDto(line), line)),
      ...(r.ended || []).map(endedToDto),
    ];
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
