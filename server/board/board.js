'use strict';
// The board: a long-lived daemon that owns every PTY ("line").
// Clients talk to it over the control pipe; each line gets its own raw data pipe.
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

// `list` preview tail: the last few rendered rows a `preview:true` list carries
// per live line, for the fleet views' glance-level "what's on screen". Rows come
// from the line's VT-emulated grid (already plain text, no ANSI), hard-capped so
// a wide grid can't bloat a reply that fans out to every card every poll.
const PREVIEW_ROWS = 3;
const PREVIEW_ROW_MAX = 160;

// Initial-command ("run" field) keystroke-feed timing. ConPTY drops keystrokes
// fed before the shell's input reader is ready, so we wait for the shell's first
// output (prompt up) — debounced by FEED_DEBOUNCE_MS after each output burst —
// before injecting, with FEED_FALLBACK_MS as a hard backstop for a shell that
// emits nothing on start. After a send, FEED_CONFIRM_MS of total silence is read
// as "the shell never reacted, so ConPTY ate the keystrokes" and the feed is
// retried, up to FEED_MAX_SENDS times total. (See makeRunFeeder.)
const FEED_DEBOUNCE_MS = 120;
const FEED_FALLBACK_MS = 1500;
const FEED_CONFIRM_MS = 500;
const FEED_MAX_SENDS = 2;

// State machine for the initial-command feed. Factored out of createLine, with
// its clock/timer/write/liveness injected, so the debounce + retry logic is
// unit-testable without spawning a pty. Drive it with onData() on every PTY
// output burst and onFallback() once after FEED_FALLBACK_MS.
//
// Double-run safety: a re-send happens ONLY on total post-send silence. The one
// false-positive direction — continued prompt output mistaken for a reaction —
// leans toward "assume delivered" (skip the retry), never toward re-sending. The
// residual double-run risk is a fresh prompt with echo OFF and a command that
// emits nothing, which is rare and bounded to one extra send by FEED_MAX_SENDS.
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

// Per-process boot nonce. Line ids come from `seq`, which resets to 0 on every
// board restart (a designed, autostart-triggered event), so an id like "1" is
// reused across restarts. Clients that cache per-line state (e.g. mcp-server's
// read cursor) must namespace it by this nonce so a reused id can't inherit a
// stale entry from a previous board process.
const BOOT = `${process.pid}-${Date.now()}`;

const sessions = new Map(); // id -> { pty, clients:Set<socket>, buf:[], sizes, server, name, shell, cwd, startedAt, lastActivity }
let seq = 0;

// Tombstones for recently-ended lines. Without these, a line's exit code is
// shown only to clients attached at the instant of death (the data-pipe
// farewell) — anyone polling `list` sees the line silently disappear, with no
// way to tell "finished cleanly" from "crashed". A capped ring keeps the memory
// bounded; `forget` lets a client dismiss one. In-memory only, so a board
// restart clears it — which is also the id-reuse hygiene: ids restart per boot,
// and a persisted tombstone for id "1" could otherwise sit next to a new boot's
// live line "1" as a stale corpse. Within one boot, `seq` never reuses an id.
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
    // Look up one tombstone by id without copying the ring — the encapsulated
    // point lookup for callers that want a single tombstone (the `screen`
    // not-live branch), instead of reaching through list() into the internals.
    get: id => items.find(t => t.id === id),
    list: () => items.slice(),
  };
}
const endedLines = makeEndedRegistry();

// Per-line rendered-screen lifecycle: lazy-init (seeded from scrollback), live
// feed, resize tracking, dispose. The emulator factory and the line's
// size/scrollback accessors are injected, so the lifecycle — including the
// efficiency invariant (no emulator built until the first read) — is unit-
// testable without spawning a pty. Mirrors makeRunFeeder / makeEndedRegistry.
//
// Seeding replays the line's existing scrollback into a freshly-created emulator
// so the very first read already reflects the current frame. Residual, accepted:
// the current frame must sit within the scrollback window; every read after init
// is exact, kept current by the live feed. feed()/resize() before the first read
// are deliberate no-ops — a line nobody screen-reads allocates nothing.
function makeScreenLifecycle(io) {
  const { create, getSize, getScrollback } = io;
  let screen = null;
  let disposed = false;   // set on the line's exit — a dead line has no screen
  function ensure() {
    // Once the line has exited (dispose ran), refuse to (re)build a screen. This
    // closes the first-read leg of the exit race: without it, a first read that
    // lands after onExit's dispose would rebuild a fresh emulator from stale
    // scrollback — returning a full grid for a line the contract says must error,
    // and leaking that emulator (onExit is already past its dispose call).
    if (disposed) return null;
    if (screen) return screen;
    const { cols, rows } = getSize();
    screen = create(cols, rows);
    // One-time, first-read only: parsing up to SCROLLBACK (2000) chunks through
    // the VT emulator is synchronous work on the board's single event loop, so a
    // heavily-repainting line's first screen read briefly stalls I/O for every
    // other line. Bounded by the scrollback cap and paid once — every read after
    // init is incremental (the live p.onData feed) — but it is not free.
    for (const chunk of getScrollback()) screen.write(chunk);
    return screen;
  }
  return {
    // Lazy-init on first read, then snapshot the current grid (a stateless read —
    // no cursor to track, unlike the delta-based raw-output read). Returns null,
    // never a torn/stale grid, when the line has exited — either before the read
    // (ensure refuses to build) or during the awaited flush (dispose lands while
    // snapshot() yields; the post-await disposed check discards the result and a
    // read against the disposed emulator that threw is swallowed only then). The
    // caller maps null to the exited-line reply.
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

// The per-boot access secret every connection must present as its first line
// (see lib.js). Assigned once in the daemon-entry block below, before either
// server starts listening — so it's always set by the time a connection arrives.
// Left null when board.js is merely require()d by a test (no listeners bound).
let SECRET = null;

// Claude Code injects a set of "you are running inside a session" identity
// markers into the env of every process it spawns. The board is often launched
// from inside a Claude Code session (`npm start` in a session, or autostart from
// a session-hosted web tier), so it inherits them — and because createLine spawns
// each Line with `{ ...process.env }`, it would pass them down to every PTY. A
// `claude` launched in such a Line then sees CLAUDE_CODE_CHILD_SESSION and treats
// itself as a nested child session: it writes NO conversation transcript JSONL,
// silently breaking every consumer that tails transcripts. Scrub them at daemon
// startup, before any Line is created, so every child the daemon ever spawns
// starts from a clean session identity.
//
// EXPLICIT allowlist, never a CLAUDE_* glob: deliberate machine-wide config a
// user exports in their shell profile (CLAUDE_EFFORT, CLAUDE_AFK_TIMEOUT_MS,
// ANTHROPIC_*, …) must survive — the daemon can't tell inherited-from-session
// from set-on-purpose, so it removes ONLY the runtime-injected session-identity
// markers, which no one sets by hand. (See _docs/issues/2026-07-07-board-scrub-
// claude-session-env.md.)
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
    // Inject the line id so a process in the shell (a Claude Code Notification
    // hook) can name its own line to POST /api/notify without guessing — the
    // precise half of the line-id bridge (cwd-match is the fallback). Additive
    // and namespaced; harmless to lines nobody queries.
    env: { ...process.env, AGENT_RELAY_SESSION: id },
  });
  const now = Date.now();
  // `pending`: sockets that have authed but are still awaiting their history
  // reconstruction (attachWithReplay). They aren't in `clients` yet — live output
  // is buffered into each one's queue so it lands AFTER the replay, never ahead of
  // it. See attachWithReplay for the ordering contract.
  const s = { pty: p, clients: new Set(), pending: new Map(), buf: [], sizes: new Map(), name: o.name || '', shell, cwd, startedAt: now, lastActivity: now };
  sessions.set(id, s);

  // Rendered screen for this line: constructed lazily on the first `screen`
  // command, sized to the live PTY dims and seeded from scrollback (see
  // makeScreenLifecycle). Once initialized it is kept current by the live feed
  // (p.onData below), resize tracking (applyMin), and disposed on exit.
  s.screen = makeScreenLifecycle({
    create: createScreen,
    getSize: () => ({ cols: p.cols, rows: p.rows }),
    getScrollback: () => s.buf,
  });

  // Data plane: a dumb raw byte pump, broadcast to every patched-in pane — but
  // gated on the access secret first (see lib.js). Until a client sends
  // `<secret>\n`, it is added to nothing and receives no scrollback, so a foreign
  // reader that can open the pipe (the OS default DACL allows read) still sees
  // nothing. Bytes after the secret line on the same connection are PTY input.
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
      // Replay history reconstructed at the current width, then join the live set
      // (async, ordering-safe — see attachWithReplay).
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
    // Buffer for sockets mid-reconstruction so this output lands after their
    // replay (attachWithReplay flushes the queue, then joins them to `clients`).
    for (const pend of s.pending.values()) pend.queue.push(d);
  });
  p.onExit(({ exitCode }) => {
    // This runs in an async pty callback OUTSIDE the control-plane dispatch's
    // try/catch — an uncaught throw here would take down the whole daemon (and
    // every other live line) on one line's exit. notifyClientsClosed guards
    // each client .end() so one wedged pane can't abort the farewell to the rest,
    // nor the cleanup below.
    const farewell = lineClosedFarewell(id, exitCode);
    notifyClientsClosed(s.clients, farewell);
    // Sockets still reconstructing history when the line dies never joined
    // `clients`; end them too (with the same farewell) so a joiner that attached
    // in the exit window isn't left hanging on a line that's already gone.
    for (const sock of s.pending.keys()) { try { sock.end(farewell); } catch { /* pane already gone */ } }
    s.pending.clear();
    try { server.close(); } catch { /* ignore */ }
    try { s.screen.dispose(); } catch { /* ignore */ }
    // Leave a tombstone so pollers can distinguish "ended" (and how) from
    // "never existed". `reason` separates an operator kill (the `end` command
    // sets endReason before the signal) from the process exiting on its own.
    endedLines.record({
      id, name: s.name, shell, cwd, exitCode,
      endedAt: Date.now(), reason: s.endReason || 'exited',
    });
    sessions.delete(id);
    log('line', id, 'closed, exit', exitCode);
  });

  // Optional initial command: type it into the live shell, which stays interactive
  // afterwards. Wait for the shell's first output (prompt up) before sending —
  // ConPTY drops keystrokes fed before the shell's input reader is ready — then
  // confirm the shell reacted and retry if it didn't, with a hard fallback for a
  // shell that's silent on start. (Logic + timing: see makeRunFeeder above.)
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
    // Log only that a run command exists and its length, not its text — the
    // command can embed a credential as an argv (e.g. --api-key=...) and
    // switchboard.log is persistent and unrotated.
    log('line', id, 'will run a command', `(${run.length} chars)`);
  }

  log('line', id, 'placed:', shell, 'in', cwd);
  return id;
}

// Send the farewell to every patched-in client, guarding each write so one
// socket in a bad state can't throw and abort the loop (leaving other panes
// un-notified) or the caller's post-loop cleanup. Factored out of p.onExit so the
// per-client isolation is unit-testable without spawning a pty.
function notifyClientsClosed(clients, farewell) {
  for (const c of clients) { try { c.end(farewell); } catch { /* pane already gone */ } }
}

// Attach a freshly-authed socket to a line, replaying its history reconstructed
// at the width the bytes were CAPTURED at (see screen-render.reconstructReplay
// for why raw-log replay garbles at any other width). The capture width is the
// PTY's width right now, snapshotted synchronously with the byte-log before the
// first await: this join's own resize arrives a beat later on the separate
// control pipe, so at this instant the PTY is still at its pre-join width — which
// is exactly the width the buffered bytes were emitted at (a line nobody has
// joined yet never resized). Reconstructing there and serializing flat logical
// lines lets the joiner re-wrap them cleanly at its own width.
//
// Reconstruction is async, so the ordering must be exact:
//   1. Snapshot the byte-log + width and register the socket in `pending` — all
//      before the first await, so no output can slip past between them.
//   2. While reconstructing, p.onData buffers live output into pend.queue (the
//      socket isn't in `clients` yet, so it isn't written directly).
//   3. After reconstruction, in one synchronous block (no await, so p.onData
//      can't interleave): write the replay, flush the queued live output behind
//      it, then join `clients` as a normal live pane.
//
// If the socket dropped mid-reconstruction, drop()/onExit already removed its
// pending entry; the delete() guard returns false and we write nothing to it.
// `reconstruct` is injected (defaulting to the real serializer) so the ordering
// is unit-testable without a pty or a real emulator.
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

// A valid terminal dimension: a finite positive integer. Guards the resize path
// so garbage can't poison a line's size via NaN (see the 'resize' handler).
const isDim = n => Number.isInteger(n) && n > 0;

// Clamp a line's PTY to its smallest patched pane (tmux-style) so no pane renders
// garbled. Each pane reports its size over its long-lived control socket; we key
// by that socket and resize the PTY to the min across all currently-patched panes.
function applyMin(s) {
  if (!s.sizes.size) return;
  let cols = Infinity, rows = Infinity;
  for (const sz of s.sizes.values()) { cols = Math.min(cols, sz.cols); rows = Math.min(rows, sz.rows); }
  // Resize the PTY, then keep the rendered screen in lockstep so its grid never
  // shears against the live dims (no-op until the screen is first read).
  try { s.pty.resize(cols, rows); s.screen.resize(cols, rows); } catch { /* line may have closed */ }
}

// Open a fresh pane/window patched through to a line. The launch recipe comes
// from the client (sb) — only it can see the caller's terminal. Falls back to
// WezTerm when the recipe is absent (older client / undetectable caller).
const DEFAULT_RECIPE = { file: 'wezterm', args: ['cli', 'spawn', '--', '{cmd}'], env: {} };

// Decide whether a launch recipe can spawn a working pane. The {cmd} token is
// only substituted when it's its OWN argv element. If a recipe embeds it inside a
// larger string (e.g. SWITCHBOARD_TERM="sh -c '{cmd}'" splits to
// ["sh","-c","'{cmd}'"]), no element equals '{cmd}', so it would silently spawn
// with the literal token and the pane never patches in. Factored out so the
// refusal logic is unit-testable without launching a process.
function paneSpawnDecision(recipe) {
  const r = recipe && recipe.file ? recipe : DEFAULT_RECIPE;
  const standalone = r.args.some(a => a === '{cmd}');
  const embedded = r.args.some(a => a !== '{cmd}' && a.includes('{cmd}'));
  return { recipe: r, standalone, embedded };
}

// Returns true if a pane process was spawned, false if the recipe was refused
// (no standalone {cmd} arg). The caller threads this into the RPC reply so a
// misconfigured SWITCHBOARD_TERM surfaces as paneOpened:false instead of a silent
// ok:true with no window. Note this reports the spawn
// *attempt*, not the pane's eventual liveness — a spawn that later errors is
// reported asynchronously via the child 'error' log, which openPane can't await.
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

// A bordered-TUI rule row: a run of horizontal box-drawing / underscore glyphs
// (the input-box borders Claude Code and friends draw). Length-gated so a short
// run inside real content isn't mistaken for a border.
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

// The preview tail for one line's rendered grid: the last `rows` non-blank rows
// of the actual output, with any bottom-anchored input box removed first. A
// Claude-style TUI draws a full-width input box at the bottom (a rule, the
// prompt line, another rule) with a status line (model, context %, usage/reset)
// below it — so a naive last-N-rows tail shows only that chrome and leaks the
// operator's usage line. We find the bottom-most rule pair (the box borders) and
// cut from the top border down; grids with no such box (a plain shell) are
// tailed as-is.
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

// The preview tail of a line, for a `preview:true` list. Reads the per-line
// screen emulator — which is lazy-init, so requesting previews warms an emulator
// for every live line and keeps it fed (the accepted cost of the opt-in:
// non-preview list callers — sb, MCP, the notify/beacon cwd resolver — allocate
// nothing). Returns [] when the screen can't be read (a line that exited
// mid-read); each row is hard-capped to PREVIEW_ROW_MAX chars.
async function screenPreview(s, rows = PREVIEW_ROWS) {
  const snap = await s.screen.read();
  if (!snap || !snap.grid) return [];
  return previewTail(snap.grid, rows).map(r => (r.length > PREVIEW_ROW_MAX ? r.slice(0, PREVIEW_ROW_MAX) : r));
}

async function handle(m, sock) {
  switch (m.cmd) {
    case 'new': {
      const id = createLine(m);
      // paneOpened: true/false when a pane was requested (so a caller learns a
      // refused recipe didn't produce a window); null when no pane was
      // requested at all (open:false — the web/MCP case, the browser is the pane).
      const paneOpened = m.open !== false ? openPane(id, m.spawn) : null;
      const s = sessions.get(id);
      sock.write(JSON.stringify({ ok: true, boot: BOOT, id, pid: s.pty.pid, shell: s.shell, name: s.name, cwd: s.cwd, dataPipe: dataPipe(id), paneOpened }) + '\n');
      break;
    }
    case 'list': {
      // Opt-in per request: only a `preview:true` list (the web poll) reads each
      // line's rendered tail — see screenPreview for why that's not free.
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
          // Live PTY grid, kept current by applyMin's resize; a spectator attach
          // adopts these dims and CSS-scales rather than resizing the shared line.
          // Additive — existing consumers ignore unknown fields.
          cols: s.pty.cols,
          rows: s.pty.rows,
        };
        if (wantPreview) line.preview = await screenPreview(s);
        return line;
      }));
      // `ended` rides alongside `lines` (additive — sb/mcp read r.lines only).
      sock.write(JSON.stringify({ ok: true, boot: BOOT, lines, ended: endedLines.list() }) + '\n');
      break;
    }
    case 'join': {
      const s = sessions.get(m.id);
      // paneOpened: the result of the join's whole point (opening a pane), or null
      // when the line doesn't exist so no pane was even attempted.
      const paneOpened = s ? openPane(m.id, m.spawn) : null;
      sock.write(JSON.stringify({ ok: !!s, id: m.id, dataPipe: s ? dataPipe(m.id) : null, paneOpened }) + '\n');
      break;
    }
    case 'end': {
      const s = sessions.get(m.id);
      // Mark BEFORE the signal: onExit fires async and reads endReason to write
      // the tombstone, so the mark must already be there.
      if (s) { s.endReason = 'killed'; s.pty.kill(); }
      sock.write(JSON.stringify({ ok: !!s }) + '\n');
      break;
    }
    case 'forget': {
      // Dismiss one tombstone. ok:false = no such tombstone (already dismissed,
      // never existed, or cleared by a board restart).
      sock.write(JSON.stringify({ ok: endedLines.forget(m.id) }) + '\n');
      break;
    }
    case 'screen': {
      // The rendered screen of a line as a stateless snapshot. Field names are a
      // consumed contract (mcp read-screen tool, `sb screen`): keep exact.
      // Confidentiality note: the grid is raw-output-grade content — it can hold
      // anything on screen (a credential typed at a prompt, PHI in a TUI, a value
      // masked in the raw stream that renders in plaintext), at the same
      // sensitivity as read_output. This command adds no new boundary: it is
      // dispatched only post-handshake behind the same per-boot access secret as
      // every other control command, and the reply is not logged. Its entire
      // confidentiality therefore rests on that secret gate — whose Windows
      // secret-file ACL is the still-open, unverified assumption tracked in
      // CONTEXT.md / the open P2 issue, not anything this feature changes.
      const s = sessions.get(m.id);
      // Live at the check — but read() awaits a flush, yielding to the event
      // loop, and p.onExit can dispose this line's screen mid-read (TOCTOU). The
      // lifecycle refuses a read once disposed and returns null, so a line that
      // exits during the read falls through to the exited-line reply below
      // instead of returning a torn/stale grid or blocking until RPC_TIMEOUT_MS.
      const snap = s ? await s.screen.read() : null;
      if (snap) {
        sock.write(JSON.stringify({ ok: true, boot: BOOT, ...snap }) + '\n');
      } else {
        // Not live (never existed, or exited — possibly during the read above).
        // Distinguish an exited line (tombstone) from one that never existed;
        // these two failure replies must be tellable apart by `ended`.
        const tomb = endedLines.get(m.id);
        if (tomb) sock.write(JSON.stringify({ ok: false, ended: true, exitCode: tomb.exitCode, reason: tomb.reason }) + '\n');
        else sock.write(JSON.stringify({ ok: false, ended: false }) + '\n');
      }
      break;
    }
    case 'resize': {
      const s = sessions.get(m.id);
      // Only store finite positive-integer sizes. A non-numeric value would
      // propagate NaN through every subsequent applyMin (Math.min) for the line
      // and wedge every pane's resize until the poisoned client disconnects.
      if (s && isDim(m.cols) && isDim(m.rows)) { s.sizes.set(sock, { cols: m.cols, rows: m.rows }); applyMin(s); }
      break;
    }
    case 'shutdown': {
      sock.write(JSON.stringify({ ok: true, dropped: sessions.size }) + '\n');
      for (const s of sessions.values()) { try { s.pty.kill(); } catch { /* ignore */ } }
      log('shutting down on request');
      setTimeout(() => process.exit(0), 50);
      break;
    }
    default:
      sock.write(JSON.stringify({ ok: false, error: 'unknown cmd: ' + m.cmd }) + '\n');
  }
}

// Control plane: newline-delimited JSON request/response. The first line on each
// connection must be the access secret (see lib.js); a connection that presents
// the wrong secret — or none within AUTH_TIMEOUT_MS — is dropped before any
// command is dispatched, so a foreign process that can open the control pipe
// still can't list, spawn, resize, or shut down lines.
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
      // Guard the whole command dispatch: a field that doesn't match the assumed
      // shape (e.g. `args` as a non-array) must not throw uncaught here and take
      // down the daemon — and every live line with it — for one bad request.
      // handle is async (the `screen` command awaits a snapshot) and dispatched
      // fire-and-forget, so this does NOT serialize commands: if a caller ever
      // pipelined an async `screen` and a later sync command on ONE socket, the
      // sync reply could be written first, transposing replies (the control plane
      // is positional newline-delimited JSON, not request-id-tagged). Reply
      // ordering therefore holds only because no caller pipelines reply-producing
      // commands on a shared socket: rpc() (lib.js) is strictly one-shot — one
      // command, one reply, then sock.end() — and the sole persistent-socket
      // command is `resize`, which writes no reply. A future client that sends
      // reply-producing commands back-to-back on a held-open socket would need
      // this loop to await sequentially (or a per-socket dispatch queue) first.
      // The .catch below only keeps an async rejection from crashing the daemon.
      try {
        const ret = handle(m, sock);
        if (ret && typeof ret.then === 'function') {
          ret.catch(e => log('handle error for cmd', m && m.cmd, '-', e.message));
        }
      } catch (e) { log('handle error for cmd', m && m.cmd, '-', e.message); }
    }
    // Post-auth cap: an oversized newline-less command would
    // otherwise grow unbounded until V8's RangeError crashes the daemon, with no
    // auth-timeout backstop once authed. makeCommandBuffer flags it; we destroy.
    if (res.overflow) { sock.destroy(); return; }
  });
  sock.on('error', () => {});
  // A pane's control socket lives for the pane's lifetime; when it drops, forget
  // that pane's size so the PTY can grow back to the remaining panes' min.
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

// Bring the board online. The control pipe is itself the mutex: only ONE process
// can listen on CTRL, so the bind is the race winner. We therefore bind FIRST and
// persist the secret to disk only from the bind-success callback — a process that
// LOSES the bind race (EADDRINUSE -> the 'error' handler above -> process.exit(0))
// never reaches persist, so it can't overwrite the winner's on-disk secret and
// permanently desync every client from the surviving daemon's in-memory secret.
// The secret is generated and assigned to the module SECRET *before* the
// bind, so any connection accepted between bind and the file-write is still
// compared against a real secret. Injectable so the ordering is unit-testable
// without a real pipe.
function bringOnline({ generate, assign, listen, persist, ready } = {}) {
  const secret = generate();
  assign(secret);                              // module SECRET set before any connection is handled
  listen(() => { persist(secret); if (ready) ready(); });  // persist ONLY after a successful bind
}

// Only bind the control pipe when run as the daemon (`node board.js`); when
// required by a test, just expose the pure helpers below.
if (require.main === module) {
  // Strip inherited Claude-session identity markers before any Line is spawned
  // (see scrubClaudeSessionMarkers). Holds for every launch path — autostart,
  // scheduled task, or `npm start` from inside a Claude session — because the
  // daemon is the single chokepoint every Line inherits its env from.
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
