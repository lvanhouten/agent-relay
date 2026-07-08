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
    // Beacon state for Claude lines: board line id -> { claudeSessionId,
    // transcriptPath, turnDoneAt }. PRESENCE OF AN ENTRY IS THE DEFINITION OF A
    // "CLAUDE LINE" — a line a Claude Code hook has beaconed via POST /api/beacon.
    // `turnDoneAt` is the wall-clock ms of the last Stop (the agent ended its turn
    // and is waiting) or null (working). Separate from `_attention` on purpose: a
    // needs-input flag and a turn-done state are independent overlays. Like
    // `_attention`, web-tier only (the board owns no such notion), lost on a
    // web-tier restart (a re-fired hook carries the full binding and re-establishes
    // it), and subject to the boot-nonce void + dead-id prune in list().
    // `claudeSessionId`/`transcriptPath` are captured for a future transcript
    // feature and never surfaced in the DTO.
    this._beacons = new Map();
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
    const id = await this._resolveLiveIdByCwd(cwd);
    if (id) this.flagAttention(id);
    return id;
  }

  // Resolve the live line id whose cwd matches `cwd` (the shared basis for the
  // /api/notify and /api/beacon cwd fallbacks). Normalizes both sides, and on a
  // same-dir tie the most recently active line (smallest idleMs) wins — over-
  // matching every same-dir line would be worse than picking the one the operator
  // is most likely staring at. Returns the id, or null for an empty/unmatched cwd.
  // Board-down throws BoardUnreachableError (-> 503), never a silent no-op.
  async _resolveLiveIdByCwd(cwd) {
    const target = normalizeCwdForMatch(cwd);
    if (!target) return null;
    let r;
    try {
      r = await this._rpc({ cmd: 'list' });
    } catch (e) {
      console.error('[sessions] board list RPC failed (cwd resolution):', e.message);
      throw new BoardUnreachableError(e);
    }
    if (!r || !r.ok) throw new BoardUnreachableError();
    const matches = r.lines
      .filter((l) => normalizeCwdForMatch(l.cwd) === target)
      .sort((a, b) => (a.idleMs ?? 0) - (b.idleMs ?? 0)); // most recently active first
    return matches.length ? matches[0].id : null;
  }

  // Apply a lifecycle beacon from a Claude Code hook (POST /api/beacon). Target
  // resolution MIRRORS /api/notify exactly: a present `sessionId` is acted on
  // directly (a dumb set — no existence check; an id for an exited/unknown line is
  // set and harmlessly pruned on the next list()); the `cwd` fallback fires ONLY
  // when `sessionId` is absent. A present-but-unmatched `sessionId` must never
  // fall through to `cwd` — that would beacon a DIFFERENT same-directory live line.
  // Events: SessionStart upserts the entry and resets turnDoneAt to null (a
  // (re)start is not a waiting state); Stop sets turnDoneAt to now, CREATING the
  // entry if absent (self-healing — a Stop alone also marks the line a Claude
  // line); SessionEnd deletes the entry (drop the marker -> the line reverts to
  // the idleMs heuristic). Returns the resolved id, or null when nothing matched.
  async beacon({ event, sessionId, claudeSessionId, transcriptPath, cwd } = {}) {
    let id = null;
    if (sessionId) id = sessionId;
    else if (cwd) id = await this._resolveLiveIdByCwd(cwd);
    if (!id) return null;

    if (event === 'SessionEnd') {
      this._beacons.delete(id);
      return id;
    }
    const entry = this._beacons.get(id) || { claudeSessionId: null, transcriptPath: null, turnDoneAt: null };
    if (claudeSessionId != null) entry.claudeSessionId = claudeSessionId;
    if (transcriptPath != null) entry.transcriptPath = transcriptPath;
    if (event === 'SessionStart') entry.turnDoneAt = null;
    else if (event === 'Stop') entry.turnDoneAt = this._now();
    this._beacons.set(id, entry);
    return id;
  }

  // Clear a flag explicitly — the WS hub calls this the instant it sees an
  // `input` frame (the operator answered from the web terminal), which is the
  // precise "cleared on next input" signal. The output-based clear in list() is
  // the fallback for input arriving via another attach (e.g. the `sb` pane).
  // Also resets a Claude line's turn-done state (keeping the marker), so one
  // input frame clears both waiting states at once — the line falls back to
  // `running`, never `quiet`.
  clearAttention(id) {
    this._attention.delete(id);
    const entry = this._beacons.get(id);
    if (entry) entry.turnDoneAt = null;
  }

  // The single "has this line emitted output since instant `ts`?" primitive,
  // shared by both staleness overlays below (_applyAttention, _applyBeacon) so
  // the check exists once, not hand-rolled twice with opposite polarity. This
  // is deliberate: the _applyAttention comment anticipates a future grace window
  // (ignore output within ~1s after the timestamp); extracting the primitive
  // means that refinement lands HERE once and reaches both overlays, instead of
  // silently drifting when a maintainer edits one copy and not the other.
  // `lastOutputAt` reads the board's idleMs back to a wall-clock instant against
  // the same injected clock the stored timestamps use.
  _outputLandedAfter(line, ts) {
    const lastOutputAt = this._now() - (line.idleMs ?? 0);
    return lastOutputAt > ts;
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
  // flaggedAt) in _outputLandedAfter rather than loosening the clear entirely —
  // it lands once there and covers turn-done too.
  _applyAttention(dto, line) {
    const flaggedAt = this._attention.get(dto.id);
    if (flaggedAt == null) return dto;
    if (this._outputLandedAfter(line, flaggedAt)) {
      this._attention.delete(dto.id);
      return dto;
    }
    return { ...dto, status: 'needs-input' };
  }

  // Overlay beacon state onto a live-line DTO, establishing the Claude-line base
  // that supersedes the idleMs heuristic (ADR-0003). A line with no `_beacons`
  // entry is not a Claude line — pass through unchanged (the heuristic stays the
  // floor). A Claude line reads `running` unless a LIVE `turnDoneAt` (no output
  // landed after the Stop) makes it `turn-done`. Output arriving after turnDoneAt
  // resets it to null but KEEPS the entry, so the line falls back to `running`,
  // never `quiet`. This clear inherits the same accepted soft-failure as
  // _applyAttention: a laggy hook racing a late TUI repaint can false-clear
  // turn-done early — a stale card, never corruption. It shares that overlay's
  // _outputLandedAfter primitive, so a future grace window covers both at once.
  // _applyAttention runs AFTER this in list(), so a live needs-input flag always
  // wins over turn-done.
  _applyBeacon(dto, line) {
    const entry = this._beacons.get(dto.id);
    if (!entry) return dto;
    if (entry.turnDoneAt != null) {
      if (!this._outputLandedAfter(line, entry.turnDoneAt)) return { ...dto, status: 'turn-done' };
      entry.turnDoneAt = null; // agent moved again; keep the marker, revert to running
    }
    return { ...dto, status: 'running' };
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
      if (this._boardBoot !== null) {
        this._attention.clear();
        this._beacons.clear();
      }
      this._boardBoot = r.boot;
    }
    // Prune web-tier state whose line is no longer live (it exited) so neither Map
    // can leak entries for dead ids or resurrect state onto a reused id.
    const liveIds = new Set(r.lines.map((l) => l.id));
    for (const id of this._attention.keys()) if (!liveIds.has(id)) this._attention.delete(id);
    for (const id of this._beacons.keys()) if (!liveIds.has(id)) this._beacons.delete(id);
    // Live lines first (beacon base, then the needs-input overlay on top so
    // needs-input outranks turn-done), then recently-ended tombstones (`ended` is
    // absent from an older board's reply — treat that as none, not an error).
    return [
      ...r.lines.map((line) => this._applyAttention(this._applyBeacon(toDto(line), line), line)),
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
