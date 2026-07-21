'use strict';
// Board-backed session store: presents the DTO/surface the API + WS hub consume;
// every op is an RPC to the board kernel. The web tier holds no PTY state, so it
// can restart without dropping a session, and sessions are shared with the `sb`
// CLI / terminal panes.
const path = require('path');
const os = require('os');
const { rpc, attach, DEFAULT_IDLE_MS } = require('./board-client');
const { resolveCwd } = require('./paths');

// Canonicalizes a cwd for the /api/notify cwd-matching bridge: path.resolve on
// both sides (collapses separators/./..), lowercased on Windows (case-insensitive
// FS). Empty/whitespace -> '' so a blank field can't match every home-dir line.
// Deliberately does NOT expand `~` — a hook's cwd is already absolute.
function normalizeCwdForMatch(cwd) {
  const raw = (cwd ?? '').trim();
  if (!raw) return '';
  const resolved = path.resolve(raw);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

// Collapses a home-rooted cwd to `~/`-prefixed for display only — cwd matching
// (/api/notify, /api/beacon) reads the board's raw cwd, not this, and `~/`
// re-expands via resolveCwd on the round trips this feeds (the "new session
// here" prefill, the picker seed). Case-insensitive prefix on Windows.
function homeRelativeCwd(cwd, home = os.homedir()) {
  if (!cwd || !home) return cwd;
  const rc = path.resolve(cwd);
  const rh = path.resolve(home);
  const [ci, hi] = process.platform === 'win32' ? [rc.toLowerCase(), rh.toLowerCase()] : [rc, rh];
  if (ci === hi) return '~';
  if (!ci.startsWith(hi + path.sep)) return cwd;
  return '~/' + rc.slice(rh.length + 1).split(path.sep).join('/');
}

function relTime(ms) {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// board line -> session DTO. status is 'running' (output within the shared idle
// threshold, wait.js's DEFAULT_IDLE_MS) or 'idle' (quiet longer — NOT "done":
// PTY bytes can't tell thinking/blocked/finished apart). Tombstones override to
// 'exited' via endedToDto. Missing/non-finite idleMs counts as 0; uses
// Number.isFinite not ?? because a NaN would compare false into 'idle' and
// render "NaNs ago".
function toDto(line) {
  const idleMs = Number.isFinite(line.idleMs) ? line.idleMs : 0;
  const dto = {
    id: line.id,
    name: line.name || `session-${line.id}`,
    shell: line.shell,
    cwd: homeRelativeCwd(line.cwd),
    pid: line.pid ?? null,
    status: idleMs < DEFAULT_IDLE_MS ? 'running' : 'idle',
    lastActive: relTime(idleMs),
  };
  // Live PTY grid from the board's list row — a spectator attach adopts these
  // dims and CSS-scales rather than resizing the shared line. Only present on
  // live lines; create/tombstone DTOs carry none until the next poll.
  if (Number.isFinite(line.cols) && Number.isFinite(line.rows)) {
    dto.cols = line.cols;
    dto.rows = line.rows;
  }
  // Rendered-screen tail from a preview:true list row — a few plain-text grid
  // rows for the fleet view's glance preview. Only attached when non-empty;
  // tombstones never carry one.
  if (Array.isArray(line.preview) && line.preview.length) dto.preview = line.preview;
  return dto;
}

// board tombstone -> exited-session DTO, built THROUGH toDto (not a parallel
// field list) so a field added to the base shape reaches both. Only exit
// metadata and dead-process overrides differ. reason:'killed' means an operator
// `end`, not the process exiting on its own.
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

// A board RPC failed (down, pipe error, malformed reply) — distinct from an
// empty list so callers can tell "unreachable" from "zero sessions": the API
// answers 503 (not 200 []) and the WS hub closes "board unreachable", not
// "session not found".
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
    // needs-input flags: session id -> wall-clock ms when a Claude Code
    // Notification hook (via POST /api/notify) reported the line blocked on a
    // prompt. Web-tier-only (the board has no such notion) — lost on restart,
    // but a re-fired hook re-flags.
    this._attention = new Map();
    // Claude-line beacon state: id -> {claudeSessionId, transcriptPath,
    // turnDoneAt}. AN ENTRY'S PRESENCE DEFINES a "Claude line" (beaconed via
    // POST /api/beacon). turnDoneAt is the last Stop's wall-clock ms (null =
    // working) — an independent overlay from _attention. Web-tier only, lost on
    // restart (a re-fired hook re-establishes it), pruned on boot-nonce change.
    // SECURITY — transcriptPath is ATTACKER-SUPPLIABLE (verbatim from the POST
    // body, only length-capped) and stored INERTLY — nothing reads it today. Any
    // future consumer MUST canonicalize + confine to the Claude projects dir and
    // reject `..`/UNC/symlink escapes before reading, or it's an arbitrary-file-read sink.
    this._beacons = new Map();
    // Board boot nonce last seen in list() — a change means the board restarted
    // and every line id may be reused, so the flags above are void.
    this._boardBoot = null;
  }

  // Marks a line needing input, unconditionally (no existence check — stay
  // dumb); list() prunes dead ids and clears the flag once output moves past it.
  flagAttention(id) {
    if (id) this._attention.set(id, this._now());
  }

  // /api/notify's cwd fallback for a hook that knows its directory but not the
  // board line id (the precise bridge is AGENT_RELAY_SESSION, injected at
  // spawn). On a same-cwd tie, the most recently active line wins. Returns the
  // flagged id, or null if nothing matches; board-down throws
  // BoardUnreachableError (503), never a silent no-op.
  async flagAttentionByCwd(cwd) {
    const id = await this._resolveLiveIdByCwd(cwd);
    if (id) this.flagAttention(id);
    return id;
  }

  // Shared basis for the /api/notify and /api/beacon cwd fallbacks (see
  // flagAttentionByCwd). Returns null for an empty/unmatched cwd; board-down
  // throws BoardUnreachableError.
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

  // Applies a Claude Code lifecycle beacon (POST /api/beacon). Target resolution
  // mirrors /notify: sessionId if present, else cwd. TRUST MODEL: any caller past
  // the operator token can drive any live line's card state — deliberate parity
  // with /api/notify's accepted ceiling; blast radius is cosmetic only (no
  // spawn, no data exposure, no push).
  // An EMPTY-STRING sessionId is treated as ABSENT on purpose (the "hook
  // couldn't resolve an id" sentinel) and falls back to cwd; a present
  // non-empty-but-unmatched sessionId must NEVER fall through to cwd (would
  // beacon a different same-dir line).
  // SessionStart upserts + resets turnDoneAt to null; Stop sets turnDoneAt to now
  // and self-heals a missing entry (a Stop alone marks a Claude line); SessionEnd
  // deletes the entry. Returns the resolved id, or null.
  async beacon({ event, sessionId, claudeSessionId, transcriptPath, cwd } = {}) {
    let id = null;
    if (sessionId) id = sessionId;            // '' is intentionally falsy -> absent (see header: empty = cwd-fallback sentinel)
    else if (cwd) id = await this._resolveLiveIdByCwd(cwd);
    if (!id) return null;

    if (event === 'SessionEnd') {
      this._beacons.delete(id);
      return id;
    }
    const entry = this._beacons.get(id) || { claudeSessionId: null, transcriptPath: null, turnDoneAt: null };
    if (claudeSessionId != null) entry.claudeSessionId = claudeSessionId;
    if (transcriptPath != null) entry.transcriptPath = transcriptPath; // UNTRUSTED path — validate before any read (see _beacons comment)
    if (event === 'SessionStart') entry.turnDoneAt = null;
    else if (event === 'Stop') entry.turnDoneAt = this._now();
    this._beacons.set(id, entry);
    return id;
  }

  // Cleared the instant the WS hub sees an `input` frame (the operator answered
  // from the web terminal); list()'s output-based clear is the fallback for
  // input via another attach (e.g. `sb`). Also resets a Claude line's turn-done
  // state, so one input frame clears both — the line falls to `running`, never `quiet`.
  clearAttention(id) {
    this._attention.delete(id);
    const entry = this._beacons.get(id);
    if (entry) entry.turnDoneAt = null;
  }

  // Shared "has this line emitted output since ts?" primitive for both
  // staleness overlays below, so a future grace window (ignore output within
  // ~1s after ts) can land once and cover both. Reads the board's idleMs back to
  // a wall-clock instant against the injected clock.
  _outputLandedAfter(line, ts) {
    const lastOutputAt = this._now() - (line.idleMs ?? 0);
    return lastOutputAt > ts;
  }

  // Overlays needs-input onto a live DTO: the flag survives only while no
  // output has landed since it was set (otherwise the agent moved again — drop it).
  //
  // ASSUMPTION: a Notification hook fires after the prompt's final paint, so the
  // line's last output should precede flaggedAt. A laggy hook racing a late
  // repaint can false-clear a flag early — a soft failure (stale card, not
  // corruption). If this shows up in practice, add a grace window in
  // _outputLandedAfter (covers turn-done too).
  _applyAttention(dto, line) {
    const flaggedAt = this._attention.get(dto.id);
    if (flaggedAt == null) return dto;
    if (this._outputLandedAfter(line, flaggedAt)) {
      this._attention.delete(dto.id);
      return dto;
    }
    return { ...dto, status: 'needs-input' };
  }

  // Overlays beacon state onto a live DTO: no _beacons entry -> not a Claude
  // line, pass through. A Claude line reads 'running' unless a live turnDoneAt
  // (no output since) makes it 'turn-done'; output afterward resets turnDoneAt
  // but KEEPS the entry, so it falls to 'running', never 'quiet'. Shares
  // _applyAttention's soft-failure risk and _outputLandedAfter primitive.
  // _applyAttention runs AFTER this in list(), so needs-input always outranks turn-done.
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
      // preview:true asks the board for each live line's rendered tail (the
      // fleet-view glance preview). Only here — the cwd resolver's list stays
      // preview-less so /api/notify + /api/beacon don't warm every screen emulator.
      r = await this._rpc({ cmd: 'list', preview: true });
    } catch (e) {
      console.error('[sessions] board list RPC failed:', e.message);
      throw new BoardUnreachableError(e);
    }
    if (!r || !r.ok) {
      console.error('[sessions] board list RPC returned a non-ok reply:', JSON.stringify(r));
      throw new BoardUnreachableError();
    }
    // A board restart resets the line-id counter, so a web tier that outlives it
    // could inherit stale flags on a reused id (the output-after-flag clear
    // usually self-heals it, but a fresh quiet line would misread needs-input).
    // The list reply's boot nonce (also namespacing mcp-server.js's read
    // cursors) tells us when to drop everything.
    if (r.boot !== this._boardBoot) {
      if (this._boardBoot !== null) {
        this._attention.clear();
        this._beacons.clear();
      }
      this._boardBoot = r.boot;
    }
    // Prunes state for lines no longer live, so neither Map can leak dead ids or
    // resurrect state onto a reused id.
    const liveIds = new Set(r.lines.map((l) => l.id));
    for (const id of this._attention.keys()) if (!liveIds.has(id)) this._attention.delete(id);
    for (const id of this._beacons.keys()) if (!liveIds.has(id)) this._beacons.delete(id);
    // Live lines (beacon base, then needs-input overlay so it outranks
    // turn-done), then tombstones (`ended` absent on an older board = none, not an error).
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
      // Same board-down contract as list()/get(): without this, api.js's
      // e.boardUnreachable check misses a bare Error and POST /sessions 500s
      // instead of 503.
      console.error('[sessions] board new RPC failed:', e.message);
      throw new BoardUnreachableError(e);
    }
    if (!r || !r.ok) throw new Error('board refused spawn');
    // Built through the same toDto() list uses, off the board's own reply, so
    // the shape can't drift and cwd reflects what the board recorded (not our
    // resolveCwd() guess); `wd` is the fallback for an older board that doesn't
    // echo cwd.
    return {
      ...toDto({ id: r.id, name: r.name, shell: r.shell, cwd: r.cwd ?? wd, pid: r.pid, idleMs: 0 }),
      lastActive: 'just now',
    };
  }

  async kill(id) {
    // Distinguishes "board unreachable" (throw -> 503) from "no such line"
    // (return false -> 404) — collapsing the two would read a board outage as a
    // permanent 404.
    let r;
    try {
      r = await this._rpc({ cmd: 'end', id });
    } catch (e) {
      console.error('[sessions] board end RPC failed:', e.message);
      throw new BoardUnreachableError(e);
    }
    if (r && r.ok) return true;
    // Not live — maybe a tombstone: DELETE on an exited session dismisses it via
    // `forget`, which says ok:false for an unknown id (an older board's
    // unknown-cmd reply does too) — both map to 404.
    let f;
    try {
      f = await this._rpc({ cmd: 'forget', id });
    } catch (e) {
      console.error('[sessions] board forget RPC failed:', e.message);
      throw new BoardUnreachableError(e);
    }
    return !!(f && f.ok);
  }

  // Per-WS attach: returns {write, resize, setSpectator, detach}. Scrollback
  // replays once on data-pipe connect; setSpectator toggles clamp participation
  // live without reattaching.
  attach(id, handlers) {
    return this._attach(id, handlers);
  }
}

module.exports = { BoardSessions, BoardUnreachableError, homeRelativeCwd };
