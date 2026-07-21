'use strict';
// The board: long-lived daemon owning every PTY ("line") - control pipe for
// commands, one raw data pipe per line.
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const pty = require('node-pty');
const { CTRL, dataPipe, lineClosedFarewell, generateSecret, persistSecret,
  makeHandshake, makeCommandBuffer, AUTH_TIMEOUT_MS } = require('./lib');
const { createScreen, reconstructReplay } = require('./screen-render');

const LOG = path.join(__dirname, 'switchboard.log');
const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`;
  try { fs.appendFileSync(LOG, line); } catch { /* best effort */ }
  if (process.stdout.isTTY) process.stdout.write(line);
};

const DEFAULT_SHELL = process.platform === 'win32'
  ? 'pwsh.exe'
  : (process.env.SHELL || 'bash');

const SCROLLBACK = 2000; // chunks of output replayed to a freshly-patched pane

// preview:true list tail: last rendered rows per line (plain text, from the VT
// grid), capped so a reply fanning out to every card every poll can't bloat.
const PREVIEW_ROWS = 3;
const PREVIEW_ROW_MAX = 160;

// Initial-command feed timing: ConPTY drops keystrokes sent before the shell's
// input reader is ready, so we wait for its first output (debounced by
// FEED_DEBOUNCE_MS) before injecting, fall back after FEED_FALLBACK_MS for a
// silent shell, and retry up to FEED_MAX_SENDS if FEED_CONFIRM_MS passes with no
// reaction (see makeRunFeeder).
const FEED_DEBOUNCE_MS = 120;
const FEED_FALLBACK_MS = 1500;
const FEED_CONFIRM_MS = 500;
const FEED_MAX_SENDS = 2;

// io (clock/timer/write/liveness) is injected so the debounce+retry state
// machine is unit-testable without a pty. Drive with onData() on every PTY
// output burst, onFallback() once after FEED_FALLBACK_MS.
//
// Re-send fires only on total post-send silence, biased toward assume-delivered
// over double-send; worst case is one extra send (FEED_MAX_SENDS) for a silent
// echo-off prompt.
function makeRunFeeder(run, io) {
  const { write, isAlive, schedule, cancel, now,
    debounceMs = FEED_DEBOUNCE_MS, confirmMs = FEED_CONFIRM_MS, maxSends = FEED_MAX_SENDS } = io;
  let sends = 0;
  let lastSendAt = 0;
  let settled = false;       // saw output after a send => the shell reacted, done
  let debounceTimer = null;
  let confirmTimer = null;

  function send() {
    if (settled || sends >= maxSends || !isAlive()) return;
    sends += 1;
    lastSendAt = now();
    try { write(run + '\r'); } catch { /* line closed */ }
    cancel(confirmTimer);
    confirmTimer = schedule(onConfirm, confirmMs);   // silence after this => retry
  }

  function onConfirm() {
    if (settled || !isAlive()) return;
    send();   // no reaction observed since lastSendAt -> re-send (capped)
  }

  return {
    // Every PTY output burst.
    onData() {
      if (settled) return;
      if (sends === 0) {
        // Pre-send: debounce the first feed until the startup output goes quiet.
        cancel(debounceTimer);
        debounceTimer = schedule(send, debounceMs);
      } else if (now() >= lastSendAt) {
        // Output after our send: the shell reacted -> delivered. Stop retrying.
        settled = true;
        cancel(debounceTimer);
        cancel(confirmTimer);
      }
    },
    // Backstop for a shell that emits nothing at all on startup.
    onFallback() { if (sends === 0) send(); },
    // Test seam.
    _state: () => ({ sends, settled }),
  };
}

// Per-process boot nonce. Line ids (`seq`) reset to 0 on every board restart, so
// an id like "1" gets reused across restarts. Clients that cache per-line state
// (e.g. mcp-server's read cursor) must namespace it by this nonce to avoid
// inheriting a stale entry from a previous board process.
const BOOT = `${process.pid}-${Date.now()}`;

const sessions = new Map(); // id -> { pty, clients:Set<socket>, buf:[], sizes, server, name, shell, cwd, startedAt, lastActivity }
let seq = 0;

// Tombstones for ended lines: without them a `list` poller just sees a line
// vanish, with no way to tell a clean exit from a crash. Capped ring keeps
// memory bounded; `forget` dismisses one. In-memory only, so a board restart
// clears it - which also keeps a reused post-restart id from sitting next to a
// stale tombstone (within one boot, `seq` never reuses an id).
const ENDED_MAX = 20;
function makeEndedRegistry(cap = ENDED_MAX) {
  const items = [];
  return {
    record(t) { items.push(t); if (items.length > cap) items.shift(); },
    forget(id) {
      const i = items.findIndex(t => t.id === id);
      if (i < 0) return false;
      items.splice(i, 1);
      return true;
    },
    // Point lookup without copying the ring (used by the `screen` not-live branch).
    get: id => items.find(t => t.id === id),
    list: () => items.slice(),
  };
}
const endedLines = makeEndedRegistry();

// Per-line rendered-screen lifecycle: lazy-init from scrollback, live feed,
// resize, dispose. Emulator factory + size/scrollback accessors are injected,
// so it's unit-testable without a pty (mirrors makeRunFeeder / makeEndedRegistry).
//
// Seeding replays existing scrollback into a fresh emulator so the first read
// already reflects the current frame - this holds only as long as the current
// frame is still within the scrollback window. feed()/resize() before the first
// read are no-ops: a line nobody screen-reads allocates nothing.
function makeScreenLifecycle(io) {
  const { create, getSize, getScrollback } = io;
  let screen = null;
  let disposed = false;   // set on the line's exit — a dead line has no screen
  function ensure() {
    // Refuse to rebuild once disposed - closes the exit race where a first read
    // landing after onExit's dispose would resurrect a stale emulator (wrong
    // grid, and it would leak since onExit already ran its dispose).
    if (disposed) return null;
    if (screen) return screen;
    const { cols, rows } = getSize();
    screen = create(cols, rows);
    // First read only: replaying up to SCROLLBACK chunks through the VT emulator
    // is sync work on the single event loop, briefly stalling every other line's
    // I/O. Bounded and paid once; later reads are incremental via the live feed.
    for (const chunk of getScrollback()) screen.write(chunk);
    return screen;
  }
  return {
    // Stateless snapshot (no cursor, unlike the delta-based raw-output read).
    // Returns null - never a torn/stale grid - if the line exited before the
    // read or mid-await (dispose can land while snapshot() yields; the
    // post-await disposed check and the swallowed emulator-throw both cover
    // that). Caller maps null to the exited-line reply.
    async read() {
      const scr = ensure();
      if (!scr) return null;
      try {
        const snap = await scr.snapshot();
        return disposed ? null : snap;
      } catch (e) {
        if (disposed) return null;   // disposed mid-flush — expected race, not an error
        throw e;
      }
    },
    // Live feed / resize: meaningful only once the emulator exists.
    feed(bytes) { if (screen) screen.write(bytes); },
    resize(cols, rows) { if (screen) screen.resize(cols, rows); },
    dispose() { disposed = true; if (screen) { screen.dispose(); screen = null; } },
    // Test seam: whether the emulator has been constructed yet.
    _initialized: () => screen !== null,
  };
}

// Per-boot access secret every connection must present as its first line (see
// lib.js); assigned once below, before either server listens. Null when
// board.js is only require()d by a test (no listeners bound).
let SECRET = null;

// Claude Code injects session-identity env vars into every process it spawns.
// The board is often launched from inside a session, and createLine forwards
// `process.env` to every PTY - so a `claude` started in a Line would see
// CLAUDE_CODE_CHILD_SESSION, treat itself as a nested child session, and write
// no transcript JSONL, silently breaking every transcript-tailing consumer.
// Scrub the markers at daemon startup, before any Line spawns, so every child
// starts from a clean session identity.
//
// Explicit allowlist, never a CLAUDE_* glob: a user's own shell-profile exports
// (CLAUDE_EFFORT, ANTHROPIC_*, ...) must survive - the daemon can't tell
// inherited-from-session apart from set-on-purpose, so it removes only the
// runtime-injected session-identity markers, which no one sets by hand.
const CLAUDE_SESSION_MARKERS = [
  'CLAUDECODE',                 // "1" — the nested-session flag Claude Code checks
  'CLAUDE_CODE_CHILD_SESSION',  // the marker that suppresses transcript writes (the incident)
  'CLAUDE_CODE_SESSION_ID',     // the parent session's id
  'CLAUDE_CODE_ENTRYPOINT',     // how the parent session was entered (cli/…)
  'CLAUDE_CODE_EXECPATH',       // the parent session's claude binary path
];
function scrubClaudeSessionMarkers(env = process.env) {
  const removed = [];
  for (const k of CLAUDE_SESSION_MARKERS) {
    if (k in env) { delete env[k]; removed.push(k); }
  }
  return removed;
}

function createLine(o = {}) {
  const id = String(++seq);
  const shell = o.shell || DEFAULT_SHELL;
  const cwd = o.cwd || process.env.USERPROFILE || process.cwd();
  const p = pty.spawn(shell, o.args || [], {
    name: 'xterm-256color',
    cols: o.cols || 120,
    rows: o.rows || 30,
    cwd,
    // Avoids node-pty's fork-based kill reaper, which AttachConsoles and
    // force-kills every PID on the shared console - in production that takes
    // down the board and every sibling line, plus flashes a conhost window. We
    // reap each line's own tree ourselves in killLineTree.
    useConptyDll: true,
    // Lets a hook in the shell (e.g. Claude's Notification hook) name its own
    // line for POST /api/notify without guessing - the precise half of the
    // line-id bridge (cwd-match is the fallback).
    env: { ...process.env, AGENT_RELAY_SESSION: id },
  });
  const now = Date.now();
  // `pending`: authed sockets still awaiting history reconstruction
  // (attachWithReplay) - not yet in `clients`, so live output queues per-socket
  // and lands after the replay, never ahead of it.
  const s = { pty: p, clients: new Set(), pending: new Map(), buf: [], sizes: new Map(), name: o.name || '', shell, cwd, startedAt: now, lastActivity: now };
  sessions.set(id, s);

  // Screen lifecycle for this line (see makeScreenLifecycle): lazy-built on the
  // first `screen` command, then kept current by the live feed, resize
  // (applyMin), and disposed on exit.
  s.screen = makeScreenLifecycle({
    create: createScreen,
    getSize: () => ({ cols: p.cols, rows: p.rows }),
    getScrollback: () => s.buf,
  });

  // Data plane: raw byte pump broadcast to every patched pane, gated by the
  // access secret (lib.js) - until a client sends `<secret>\n` it's added to
  // nothing and gets no scrollback, so a foreign reader that can open the pipe
  // (default DACL allows read) still sees nothing. Bytes after the secret line
  // on the same connection are PTY input.
  const server = net.createServer(sock => {
    let authed = false;
    const gate = makeHandshake(SECRET);   // shared pre-auth handshake (cap + compare)
    const authTimer = setTimeout(() => { if (!authed) sock.destroy(); }, AUTH_TIMEOUT_MS);
    const drop = () => { clearTimeout(authTimer); s.clients.delete(sock); s.pending.delete(sock); };
    sock.on('data', d => {
      if (authed) { p.write(d.toString('utf8')); return; }
      const r = gate.feed(d);
      if (r.type === 'pending') return;
      if (r.type === 'overflow' || r.type === 'reject') { sock.destroy(); return; }
      authed = true;
      clearTimeout(authTimer);
      if (r.rest) p.write(r.rest);  // input bytes bundled in the same chunk as the secret line
      // Replay history reconstructed at the current width, then join live
      // (async, ordering-safe - see attachWithReplay).
      attachWithReplay(s, id, sock);
    });
    sock.on('close', drop);
    sock.on('error', drop);
  });
  server.on('error', e => log('data pipe error on line', id, e.message));
  server.listen(dataPipe(id));
  s.server = server;

  p.onData(d => {
    s.lastActivity = Date.now();
    s.buf.push(d);
    if (s.buf.length > SCROLLBACK) s.buf.shift();
    s.screen.feed(d);   // no-op until the line's screen is first read (lazy)
    for (const c of s.clients) c.write(d);
    // Queue for sockets mid-reconstruction so live output lands after their
    // replay (attachWithReplay flushes then joins them to `clients`).
    for (const pend of s.pending.values()) pend.queue.push(d);
  });
  p.onExit(({ exitCode }) => {
    // Runs outside the control-plane dispatch's try/catch - an uncaught throw
    // here would kill the daemon and every live line. notifyClientsClosed guards
    // each client .end() so one wedged pane can't abort the farewell or the
    // cleanup below.
    const farewell = lineClosedFarewell(id, exitCode);
    notifyClientsClosed(s.clients, farewell);
    // Pending sockets (mid-reconstruction when the line died) never joined
    // `clients`; end them too so a joiner in the exit window doesn't hang on a
    // dead line.
    for (const sock of s.pending.keys()) { try { sock.end(farewell); } catch { /* pane already gone */ } }
    s.pending.clear();
    try { server.close(); } catch { /* ignore */ }
    try { s.screen.dispose(); } catch { /* ignore */ }
    // Tombstone lets pollers distinguish ended (and how) from never-existed;
    // `reason` separates an operator kill (`end` sets endReason before
    // signaling) from a self-exit.
    endedLines.record({
      id, name: s.name, shell, cwd, exitCode,
      endedAt: Date.now(), reason: s.endReason || 'exited',
    });
    sessions.delete(id);
    log('line', id, 'closed, exit', exitCode);
  });

  // Optional initial command: types into the live shell, which stays open
  // afterwards. ConPTY-safe feed/retry logic lives in makeRunFeeder above.
  const run = typeof o.run === 'string' ? o.run.trim() : '';
  if (run) {
    const feeder = makeRunFeeder(run, {
      write: d => p.write(d),
      isAlive: () => sessions.has(id),
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: t => clearTimeout(t),
      now: () => Date.now(),
    });
    p.onData(() => feeder.onData());
    setTimeout(() => feeder.onFallback(), FEED_FALLBACK_MS);
    // Log only that a run command exists (+ length), never its text - it can
    // embed a credential (--api-key=...) and switchboard.log is persistent,
    // unrotated.
    log('line', id, 'will run a command', `(${run.length} chars)`);
  }

  log('line', id, 'placed:', shell, 'in', cwd);
  return id;
}

// Kills a line's whole descendant tree, flash-free and board-safe. useConptyDll
// skips node-pty's fork-based kill reaper, which would force-kill every PID on
// the shared console (board and siblings included). `taskkill /T` instead walks
// the PID tree DOWN from the line's shell, so it can only reach descendants -
// never the board or a sibling line. Await the tree walk BEFORE pty.kill:
// killing the shell first would orphan its grandchildren before taskkill can
// see them.
function killLineTree(s) {
  if (process.platform !== 'win32') {
    try { s.pty.kill(); } catch { /* already gone */ }
    return Promise.resolve();
  }
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { s.pty.kill(); } catch { /* already gone */ }
      resolve();
    };
    try {
      const tk = spawn('taskkill', ['/pid', String(s.pty.pid), '/T', '/F'], {
        windowsHide: true,   // the flag node-pty's internal fork omits — no conhost pops
        stdio: 'ignore',
      });
      tk.on('close', finish);
      tk.on('error', finish);   // taskkill missing/failed — pty.kill still runs in finish()
      // A wedged taskkill must never outlive the control-plane RPC timeout.
      setTimeout(finish, 4000);
    } catch { finish(); }
  });
}

// Guards each client .end() so one bad socket can't abort the loop (leaving
// others un-notified) or the caller's post-loop cleanup. Factored out of
// p.onExit so this isolation is unit-testable without a pty.
function notifyClientsClosed(clients, farewell) {
  for (const c of clients) { try { c.end(farewell); } catch { /* pane already gone */ } }
}

// Attaches a freshly-authed socket, replaying history reconstructed at the
// PTY's CURRENT width (raw-log replay garbles at any other width - see
// screen-render.reconstructReplay). Width is snapshotted synchronously, before
// the first await, since this join's own resize arrives later on a separate
// pipe - so the pre-join width is still the width the buffered bytes were
// captured at.
//
// Ordering: register in `pending` before any await (so nothing can slip past);
// p.onData queues live output into pend.queue while reconstructing; then, in
// one sync block, write the replay, flush the queue, and join `clients` - no
// await, so p.onData can't interleave. A socket that dropped mid-reconstruction
// fails the pending.delete() guard and gets nothing written. `reconstruct` is
// injected for testability without a pty or real emulator.
async function attachWithReplay(s, id, sock, reconstruct = reconstructReplay) {
  const chunks = s.buf.slice();
  const cols = s.pty.cols, rows = s.pty.rows;
  const pend = { queue: [] };
  s.pending.set(sock, pend);
  let replay;
  try {
    replay = await reconstruct(chunks, cols, rows);
  } catch (e) {
    // Emulator failed — fall back to the raw byte-log so the joiner still gets
    // history (the pre-fix behavior, garble-prone but non-empty).
    log('line', id, 'replay reconstruction failed, using raw log -', e.message);
    replay = chunks.join('');
  }
  if (!s.pending.delete(sock)) return;   // socket gone (drop/onExit already handled it)
  try {
    sock.write(replay);
    for (const q of pend.queue) sock.write(q);
    s.clients.add(sock);
  } catch { /* pane vanished between the guard and the flush */ }
}

// Finite positive integer only - blocks NaN poisoning a line's size via the
// resize handler.
const isDim = n => Number.isInteger(n) && n > 0;

// Clamps the PTY to its smallest patched pane (tmux-style) so no pane renders
// garbled - keyed by each pane's control socket, resized to the min across all
// currently-patched panes.
function applyMin(s) {
  if (!s.sizes.size) return;
  let cols = Infinity, rows = Infinity;
  for (const sz of s.sizes.values()) { cols = Math.min(cols, sz.cols); rows = Math.min(rows, sz.rows); }
  // Resize the PTY, then the rendered screen in lockstep so its grid never
  // shears against live dims (no-op before first read).
  try { s.pty.resize(cols, rows); s.screen.resize(cols, rows); } catch { /* line may have closed */ }
}

// Launch recipe comes from the client (sb) - only it can see the caller's
// terminal; falls back to WezTerm when absent (older client / undetectable
// caller).
const DEFAULT_RECIPE = { file: 'wezterm', args: ['cli', 'spawn', '--', '{cmd}'], env: {} };

// {cmd} substitutes only when it's its OWN argv element - a recipe embedding it
// in a larger string (SWITCHBOARD_TERM="sh -c '{cmd}'" splits to
// ["sh","-c","'{cmd}'"]) has no element equal to '{cmd}', so it would silently
// spawn with the literal token and never patch in. Factored out for
// unit-testability.
function paneSpawnDecision(recipe) {
  const r = recipe && recipe.file ? recipe : DEFAULT_RECIPE;
  const standalone = r.args.some(a => a === '{cmd}');
  const embedded = r.args.some(a => a !== '{cmd}' && a.includes('{cmd}'));
  return { recipe: r, standalone, embedded };
}

// Returns whether a pane was spawned (false = recipe refused, no standalone
// {cmd}) so a misconfigured SWITCHBOARD_TERM surfaces as paneOpened:false, not
// a silent ok:true with no window. Reports the spawn attempt only - a later
// spawn error surfaces async via the child 'error' log, which this can't await.
function openPane(id, recipe) {
  const { recipe: r, standalone, embedded } = paneSpawnDecision(recipe);
  const cmd = [process.execPath, path.join(__dirname, 'patch.js'), id];
  if (!standalone) {
    log('pane spawn skipped for line', id, '- recipe has no standalone {cmd} arg',
      embedded ? '({cmd} is embedded in a larger string — it must be its own argument; join the line manually with `sb join ' + id + '`)' : '');
    return false;
  }
  const args = r.args.flatMap(a => (a === '{cmd}' ? cmd : [a]));
  const child = spawn(r.file, args, {
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ...(r.env || {}) },
  });
  child.on('error', e => log('pane spawn failed for line', id, 'via', r.file, '-', e.message));
  child.unref();
  return true;
}

// Bordered-TUI rule row: box-drawing/underscore glyphs (the input-box borders
// Claude Code draws). Length-gated so a short run inside real content isn't
// mistaken for a border.
const RULE_CHARS = new Set(
  '─━┄┅┈┉╌╍═' + // ─ ━ ┄ ┅ ┈ ┉ ╌ ╍ ═
  '┌┐└┘├┤┬┴┼' + // ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼
  '╭╮╯╰' + // ╭ ╮ ╯ ╰
  '_'
);
function isRuleRow(line) {
  const t = line.trim();
  if (t.length < 8) return false;
  for (const ch of t) if (!RULE_CHARS.has(ch)) return false;
  return true;
}

// Last `rows` non-blank rows of a line's grid, with any bottom-anchored input
// box stripped first. A Claude-style TUI draws a full-width box (rule, prompt,
// rule) plus a status line below it - a naive tail would leak that chrome and
// the operator's usage line. We find the bottom-most rule pair and cut from the
// top border down; a plain shell (no box) is tailed as-is.
function previewTail(grid, rows) {
  let lines = grid.split('\n');
  let bottomRule = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isRuleRow(lines[i])) { bottomRule = i; break; }
  }
  if (bottomRule >= 0) {
    let topRule = -1;
    for (let i = bottomRule - 1; i >= 0; i--) {
      if (isRuleRow(lines[i])) { topRule = i; break; }
    }
    lines = lines.slice(0, topRule >= 0 ? topRule : bottomRule);
  }
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.slice(-rows);
}

// Preview tail for a `preview:true` list, via the lazy-init per-line screen
// emulator - requesting previews warms and feeds an emulator for every live
// line (accepted cost of opt-in; other callers allocate nothing). Returns []
// if unreadable (exited mid-read); rows capped to PREVIEW_ROW_MAX.
async function screenPreview(s, rows = PREVIEW_ROWS) {
  const snap = await s.screen.read();
  if (!snap || !snap.grid) return [];
  return previewTail(snap.grid, rows).map(r => (r.length > PREVIEW_ROW_MAX ? r.slice(0, PREVIEW_ROW_MAX) : r));
}

async function handle(m, sock) {
  switch (m.cmd) {
    case 'new': {
      const id = createLine(m);
      // paneOpened: true/false when a pane was requested (refused recipe ->
      // caller learns no window opened); null when none was requested
      // (open:false - web/MCP, the browser is the pane).
      const paneOpened = m.open !== false ? openPane(id, m.spawn) : null;
      const s = sessions.get(id);
      sock.write(JSON.stringify({ ok: true, boot: BOOT, id, pid: s.pty.pid, shell: s.shell, name: s.name, cwd: s.cwd, dataPipe: dataPipe(id), paneOpened }) + '\n');
      break;
    }
    case 'list': {
      // Opt-in: only `preview:true` (the web poll) reads each line's rendered
      // tail - see screenPreview for cost.
      const wantPreview = m.preview === true;
      const lines = await Promise.all([...sessions].map(async ([id, s]) => {
        const line = {
          id,
          name: s.name,
          pid: s.pty.pid,
          shell: s.shell,
          cwd: s.cwd,
          joined: s.clients.size,
          uptimeMs: Date.now() - s.startedAt,
          idleMs: Date.now() - s.lastActivity,
          // Live PTY dims, kept current by applyMin; a spectator attach adopts
          // them and CSS-scales instead of resizing the shared line. Additive
          // field - old consumers ignore it.
          cols: s.pty.cols,
          rows: s.pty.rows,
        };
        if (wantPreview) line.preview = await screenPreview(s);
        return line;
      }));
      // `ended` rides alongside `lines` (additive - sb/mcp read r.lines only).
      sock.write(JSON.stringify({ ok: true, boot: BOOT, lines, ended: endedLines.list() }) + '\n');
      break;
    }
    case 'join': {
      const s = sessions.get(m.id);
      // paneOpened is the join's whole point (opening a pane), or null if the
      // line doesn't exist so nothing was attempted.
      const paneOpened = s ? openPane(m.id, m.spawn) : null;
      sock.write(JSON.stringify({ ok: !!s, id: m.id, dataPipe: s ? dataPipe(m.id) : null, paneOpened }) + '\n');
      break;
    }
    case 'end': {
      const s = sessions.get(m.id);
      // Mark BEFORE the signal - onExit fires async and reads endReason for the
      // tombstone, so it must already be set.
      if (s) { s.endReason = 'killed'; await killLineTree(s); }
      sock.write(JSON.stringify({ ok: !!s }) + '\n');
      break;
    }
    case 'forget': {
      // Dismiss one tombstone; ok:false = no such tombstone (dismissed, never
      // existed, or cleared by a restart).
      sock.write(JSON.stringify({ ok: endedLines.forget(m.id) }) + '\n');
      break;
    }
    case 'screen': {
      // Stateless snapshot of a line's rendered screen; field names are a
      // consumed contract (mcp read-screen, `sb screen`) - keep exact.
      // Same sensitivity as read_output (can hold a credential, PHI, or a
      // masked value rendered in plaintext) and no new boundary: gated by the
      // same per-boot secret as every command, reply unlogged. Confidentiality
      // rests entirely on that secret gate, whose Windows ACL is still
      // unverified.
      const s = sessions.get(m.id);
      // TOCTOU: live at the check, but read() awaits a flush and p.onExit can
      // dispose the screen mid-read. The lifecycle refuses once disposed and
      // returns null, so an exit-during-read falls through to the exited-line
      // reply below instead of a torn/stale grid or a hang.
      const snap = s ? await s.screen.read() : null;
      if (snap) {
        sock.write(JSON.stringify({ ok: true, boot: BOOT, ...snap }) + '\n');
      } else {
        // Not live (never existed, or exited - possibly during the read above);
        // `ended` lets the two failure cases be told apart.
        const tomb = endedLines.get(m.id);
        if (tomb) sock.write(JSON.stringify({ ok: false, ended: true, exitCode: tomb.exitCode, reason: tomb.reason }) + '\n');
        else sock.write(JSON.stringify({ ok: false, ended: false }) + '\n');
      }
      break;
    }
    case 'resize': {
      const s = sessions.get(m.id);
      // Only finite positive integers - a non-numeric value would propagate NaN
      // through every later applyMin (Math.min), wedging every pane's resize
      // until the bad client disconnects.
      if (s && isDim(m.cols) && isDim(m.rows)) { s.sizes.set(sock, { cols: m.cols, rows: m.rows }); applyMin(s); }
      break;
    }
    case 'shutdown': {
      sock.write(JSON.stringify({ ok: true, dropped: sessions.size }) + '\n');
      // Reaps every line's whole tree (not just shells) so shutdown can't
      // strand detached grandchildren - same board-safe path as `end`.
      await Promise.all([...sessions.values()].map(killLineTree));
      log('shutting down on request');
      setTimeout(() => process.exit(0), 50);
      break;
    }
    default:
      sock.write(JSON.stringify({ ok: false, error: 'unknown cmd: ' + m.cmd }) + '\n');
  }
}

// Control plane: newline-delimited JSON req/response. First line must be the
// access secret (lib.js) - wrong or missing (within AUTH_TIMEOUT_MS) drops the
// connection before any command dispatches, so a foreign pipe-opener still
// can't list/spawn/resize/shutdown.
const board = net.createServer(sock => {
  let authed = false;
  let cmd = null;                        // post-auth command accumulator (makeCommandBuffer)
  const gate = makeHandshake(SECRET);    // shared pre-auth handshake (cap + compare)
  const authTimer = setTimeout(() => { if (!authed) sock.destroy(); }, AUTH_TIMEOUT_MS);
  sock.on('data', chunk => {
    let res;
    if (!authed) {
      const r = gate.feed(chunk);
      if (r.type === 'pending') return;
      if (r.type === 'overflow' || r.type === 'reject') { sock.destroy(); return; }
      authed = true;
      clearTimeout(authTimer);
      cmd = makeCommandBuffer(r.rest);   // bytes after the secret line begin the command stream
      res = cmd.feed('');                // drain any command bundled in the secret-line chunk
    } else {
      res = cmd.feed(chunk.toString('utf8'));
    }
    for (const line of res.lines) {
      if (!line.trim()) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      // Guards the dispatch: a malformed field (e.g. non-array `args`) must not
      // throw uncaught here and take down the daemon (and every line with it).
      //
      // handle() is async and fire-and-forget, so this does NOT serialize
      // commands - replies are positional, not request-id-tagged, so a
      // pipelined async `screen` ahead of a sync command on one socket could
      // have its reply overtaken. Holds today only because no caller pipelines
      // reply-producing commands on one socket: rpc() (lib.js) is one-shot (one
      // command, one reply, then sock.end()), and the only persistent-socket
      // command, `resize`, has no reply. A future back-to-back caller would need
      // sequential awaiting or a per-socket queue here.
      //
      // The .catch below only stops an async rejection from crashing the daemon.
      try {
        const ret = handle(m, sock);
        if (ret && typeof ret.then === 'function') {
          ret.catch(e => log('handle error for cmd', m && m.cmd, '-', e.message));
        }
      } catch (e) { log('handle error for cmd', m && m.cmd, '-', e.message); }
    }
    // Post-auth cap: an oversized newline-less command would otherwise grow
    // unbounded until V8 RangeErrors the daemon (no auth-timeout backstop once
    // authed). makeCommandBuffer flags it; we destroy.
    if (res.overflow) { sock.destroy(); return; }
  });
  sock.on('error', () => {});
  // A pane's control socket lives for its lifetime; on drop, forget its size so
  // the PTY can grow back to the remaining panes' min.
  sock.on('close', () => {
    clearTimeout(authTimer);
    for (const s of sessions.values()) if (s.sizes.delete(sock)) applyMin(s);
  });
});

board.on('error', e => {
  if (e.code === 'EADDRINUSE') { log('board already running — exiting'); process.exit(0); }
  log('board error:', e.message);
  throw e;
});

// The control pipe IS the mutex - only one process can bind CTRL, so the bind
// is the race winner. Bind first, persist the secret to disk only from the
// bind-success callback: a loser (EADDRINUSE -> the 'error' handler -> exit(0))
// never reaches persist, so it can't overwrite the winner's on-disk secret and
// desync every client. SECRET is assigned before the bind, so a connection
// accepted between bind and file-write still compares against a real secret.
// Injectable so the ordering is unit-testable without a real pipe.
function bringOnline({ generate, assign, listen, persist, ready } = {}) {
  const secret = generate();
  assign(secret);                              // module SECRET set before any connection is handled
  listen(() => { persist(secret); if (ready) ready(); });  // persist ONLY after a successful bind
}

// Only bind the control pipe when run as the daemon (`node board.js`); when
// required by a test, just expose the pure helpers below.
if (require.main === module) {
  // Strip inherited Claude-session markers before any Line spawns
  // (scrubClaudeSessionMarkers) - holds for every launch path (autostart,
  // scheduled task, `npm start` in-session) since the daemon is the one
  // chokepoint every Line's env comes from.
  const scrubbed = scrubClaudeSessionMarkers();
  if (scrubbed.length) log('scrubbed inherited Claude-session markers:', scrubbed.join(', '));
  bringOnline({
    generate: generateSecret,
    assign: s => { SECRET = s; },
    listen: cb => board.listen(CTRL, cb),
    persist: s => persistSecret(s),
    ready: () => log('switchboard online:', CTRL),
  });
}

module.exports = { paneSpawnDecision, openPane, handle, notifyClientsClosed, attachWithReplay, makeRunFeeder, bringOnline, makeEndedRegistry, endedLines, makeScreenLifecycle, screenPreview, previewTail, isRuleRow, scrubClaudeSessionMarkers, CLAUDE_SESSION_MARKERS };
