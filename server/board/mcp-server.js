#!/usr/bin/env node
'use strict';
// MCP server over the switchboard board — gives an agent programmatic (non-pane)
// access to persistent PTY lines: create one, read its output, type into it, end
// it. Unlike `sb`, this never opens a terminal tab — `switchboard_read_output` /
// `switchboard_send_input` read and write the line's raw byte stream directly,
// the same seam `board-client.js` uses for the web tier. A human can still
// `sb join <id>` a real pane onto any line this creates.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { connectPipe, dataPipe, rpc } = require('./lib');
const { waitForIdleOrExit } = require('./wait');
// rpc() (one control request -> one response, with a timeout) is shared from
// lib.js so its framing can't drift from sb.js / board-client.js.

// The board always replays its full scrollback to a fresh attach. We track how
// much of that stream each line has already handed back so repeat reads return
// only the new tail instead of the whole buffer every time.
//
// Lifecycle hazards this cache has to survive (all three are real — see below):
//  1. Board restart reuses line ids (board.js `seq` resets to 0), so the cursor
//     must be namespaced by the board's per-process boot nonce; a stale entry
//     from a previous board must never apply to a freshly-reused id.
//  2. A line that exits should drop its cursor, or the entry leaks forever in a
//     process explicitly designed to outlive Claude Code session restarts.
//  3. Concurrent reads of the same line share one cursor entry; the update must
//     be monotonic (never roll the cursor backward and re-deliver, never jump it
//     forward past output no reader ever saw).
const seen = new Map(); // "<boot>:<id>" -> chars already returned
let boot = null;        // the board's current boot nonce; re-probed on a TTL
let bootTs = 0;         // when `boot` was last confirmed against a live board
const BOOT_TTL_MS = 3000; // re-probe the nonce at most this often (N2: hot-path latency)

// The board's list RPC, injectable so the cursor logic can be unit-tested without
// a live board. Defaults to the shared lib.rpc(); tests swap it via __setRpc().
let probeRpc = (msg, opts) => rpc(msg, opts);

// Pure cursor-advance decision, factored out of readOutput's finish() so it can
// be tested in isolation. Given the current cache, a cache key (or null when the
// board identity is unconfirmed — see refreshBoot), the total chars observed this
// read, and whether the pipe actually closed, it returns how many chars were
// already delivered (so the caller can compute the new-only delta) and mutates
// `cache` for the next read:
//  - monotonic advance (never roll the cursor back and re-deliver),
//  - drop the entry only when the pipe closed (the line ended) — NOT on
//    content-sniffing for the farewell substring, which a live program echoing
//    "closed (exit N)" would trip (W2),
//  - never read from or write to the cache under a null key (unconfirmed nonce),
//    so a stale nonce can't collide with an orphaned entry (C1 sub-defect 3).
function advanceCursor(cache, key, textLen, pipeClosed) {
  if (!key) return 0;
  const already = cache.get(key) || 0;
  cache.set(key, Math.max(already, textLen));
  if (pipeClosed) cache.delete(key);
  return already;
}

// Learn the board's boot nonce. When it changes (a restart happened), every
// cached cursor is from a dead board process and reused ids would inherit stale
// values, so drop the whole cache.
//
// Returns { boot, confirmed }. `confirmed` is true only when this call (or a
// recent one inside the TTL) actually reached the board and read its nonce. A
// failed probe returns confirmed:false with whatever stale `boot` we last had —
// the caller MUST NOT key the cursor cache off an unconfirmed nonce, because a
// board restart we couldn't observe + a reused id + a leaked pre-restart entry
// would collide and silently truncate (C1 sub-defect 3, the re-corruption
// window). N2: skip the round-trip entirely while a confirmed nonce is fresh.
async function refreshBoot() {
  if (boot && Date.now() - bootTs < BOOT_TTL_MS) return { boot, confirmed: true };
  const r = await probeRpc({ cmd: 'list' }, { autostart: false }).catch(() => null);
  if (r && r.boot) {
    if (r.boot !== boot) { seen.clear(); boot = r.boot; }
    bootTs = Date.now();
    return { boot, confirmed: true };
  }
  return { boot, confirmed: false };
}

const DEFAULT_TAIL_CHARS = 4000;

async function readOutput(id, { waitMs = 400, maxWaitMs = 3000, tailChars = DEFAULT_TAIL_CHARS, full = false } = {}) {
  const { boot: b, confirmed } = await refreshBoot();
  // Only use the cursor cache when the board's identity is confirmed. If the
  // probe failed we can't tell a restart from a hiccup, so keying off a possibly
  // stale nonce risks colliding with an orphaned entry (silent truncation). In
  // that case read without a cursor: return the fresh tail, never touch `seen`.
  const key = confirmed ? `${b}:${id}` : null;
  return new Promise((resolve, reject) => {
    connectPipe(dataPipe(id), { retries: 3, delay: 50 }).then(sock => {
      let text = '';
      let quiet = null;
      let finished = false;
      let pipeClosed = false; // set by close/error — the line actually ended
      const hardStop = setTimeout(finish, maxWaitMs);
      function arm() {
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(finish, waitMs);
      }
      function finish() {
        if (finished) return;
        finished = true;
        clearTimeout(hardStop);
        if (quiet) clearTimeout(quiet);
        try { sock.end(); } catch { /* already closed */ }
        const already = advanceCursor(seen, key, text.length, pipeClosed);
        const delta = text.slice(already);
        if (full || delta.length <= tailChars) { resolve(delta); return; }
        const dropped = delta.length - tailChars;
        resolve(`[switchboard: showing last ${tailChars} of ${delta.length} new chars — ${dropped} earlier chars dropped; pass full:true to switchboard_read_output to see everything]\n` + delta.slice(-tailChars));
      }
      sock.on('data', d => { text += d.toString('utf8'); arm(); });
      sock.on('error', () => { pipeClosed = true; finish(); });
      sock.on('close', () => { pipeClosed = true; finish(); });
      arm();
    }, reject);
  });
}

// Drop every cursor for a line id across all boot nonces. Called when a line is
// ended via switchboard_end_line, so its entry doesn't leak (C1 sub-defect 1:
// end_line without a following readOutput used to orphan the cursor until the
// next observed board restart). Nonce-agnostic on purpose — the caller ending a
// line may not have a confirmed nonce, and stale entries under a dead nonce are
// exactly what we want gone too.
function forgetLine(id) {
  for (const key of seen.keys()) if (key.endsWith(`:${id}`)) seen.delete(key);
}

function sendInput(id, text, submit) {
  return new Promise((resolve, reject) => {
    connectPipe(dataPipe(id), { retries: 3, delay: 50 }).then(sock => {
      sock.write(text + (submit ? '\r' : ''), err => {
        try { sock.end(); } catch { /* already closed */ }
        if (err) reject(err); else resolve();
      });
    }, reject);
  });
}

const server = new McpServer({ name: 'switchboard', version: '1.0.0' });

server.registerTool('switchboard_new_line', {
  title: 'Start a switchboard line',
  description: 'Start a new persistent shell line on the switchboard board. It ' +
    'keeps running after this call returns and survives Claude Code session ' +
    'restarts/compaction — read its output with switchboard_read_output and type ' +
    'into it with switchboard_send_input. No terminal tab is opened; the user can ' +
    '`sb join <id>` a real pane onto it at any time.',
  inputSchema: {
    shell: z.string().optional().describe('Shell to launch (default: pwsh.exe on Windows, $SHELL elsewhere)'),
    cwd: z.string().optional().describe('Working directory (default: the user profile dir)'),
    run: z.string().optional().describe('Initial command to type into the shell once it comes up'),
    name: z.string().optional().describe('Optional label shown in switchboard_list_lines'),
  },
}, async ({ shell, cwd, run, name }) => {
  const r = await rpc({ cmd: 'new', open: false, shell, cwd, run, name });
  return { content: [{ type: 'text', text: JSON.stringify(r) }] };
});

server.registerTool('switchboard_list_lines', {
  title: 'List switchboard lines',
  description: 'List active switchboard lines: id, name (the label given when the ' +
    'line was created — via the agent-relay app or switchboard_new_line\'s name ' +
    'param; null if none was set, e.g. lines started from `sb new`, which has no ' +
    'naming option), pid, shell, cwd, how many panes/clients are attached, uptime, ' +
    'idle time. Always mention the name when reporting on a line, not just its id.',
  inputSchema: {},
}, async () => {
  const r = await rpc({ cmd: 'list' }, { autostart: false }).catch(() => ({ lines: [] }));
  const lines = (r.lines || []).map(l => ({ ...l, name: l.name || null }));
  return { content: [{ type: 'text', text: JSON.stringify(lines) }] };
});

server.registerTool('switchboard_read_output', {
  title: 'Read switchboard line output',
  description: 'Read new output from a switchboard line since the last read of it. ' +
    'Waits for output to go briefly quiet before returning, up to maxWaitMs. ' +
    'ALWAYS call this first without full — a line that has been running for a ' +
    'while, or was created outside this MCP session, can have a huge backlog, ' +
    'and the default only returns the last tailChars of it. If that is not ' +
    'enough, the response says exactly how much was cut and you can re-read ' +
    'with full:true to get the rest — do not reach for full:true up front just ' +
    'because the user asked for "the output" or "everything"; the tail is ' +
    'almost always what they actually want, and it is cheaper to re-read than ' +
    'to dump a huge scrollback nobody needed.',
  inputSchema: {
    id: z.string().describe('Line id, from switchboard_new_line or switchboard_list_lines'),
    waitMs: z.number().int().positive().optional().describe('Quiet period to wait for before returning (default 400)'),
    maxWaitMs: z.number().int().positive().optional().describe('Hard cap on total wait time (default 3000)'),
    tailChars: z.number().int().positive().optional().describe('Cap on returned chars when there is more new output than this (default 4000)'),
    full: z.boolean().optional().describe('Only set this on a follow-up call, after a first read said output was truncated and you actually need the dropped part. Do not set it on your first read of a line (default false)'),
  },
}, async ({ id, waitMs, maxWaitMs, tailChars, full }) => {
  try {
    const text = await readOutput(id, { waitMs, maxWaitMs, tailChars, full });
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `no such line, or it has ended (${e.code || e.message})` }], isError: true };
  }
});

server.registerTool('switchboard_wait_for_idle', {
  title: 'Wait for a switchboard line to go idle or exit',
  description: 'Blocks until a line stops producing new output for idleMs (it ' +
    'went idle — finished a turn, hit a prompt, is waiting on a decision, or is ' +
    'wedged; this call cannot tell which) or its process exits, whichever happens ' +
    'first, up to maxWaitMs. Call this the way you would call any tool that might ' +
    'take a while and that you want to be notified about rather than block on — ' +
    'the tool call itself is the thing to run in the background; its return is the ' +
    'wake. This only works if your harness can run an arbitrary MCP tool call in ' +
    'the background; if it cannot (e.g. only plain shell commands are ' +
    'backgroundable), run `sb wait <id> [idleMs] [maxWaitMs]` instead — same ' +
    'detection logic (server/board/wait.js), reachable as a Bash command. After ' +
    'either one returns, use switchboard_read_output to see what actually ' +
    'happened; neither tells you what or why, only that something is worth ' +
    'looking at.',
  inputSchema: {
    id: z.string().describe('Line id'),
    idleMs: z.number().int().positive().optional().describe('No new output for this long counts as idle (default 12000)'),
    maxWaitMs: z.number().int().positive().optional().describe('Give up and return reason:"timeout" after this long (default 600000)'),
  },
}, async ({ id, idleMs, maxWaitMs }) => {
  try {
    const r = await waitForIdleOrExit(id, { idleMs, maxWaitMs });
    return { content: [{ type: 'text', text: JSON.stringify(r) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `no such line, or it has already ended (${e.code || e.message})` }], isError: true };
  }
});

server.registerTool('switchboard_send_input', {
  title: 'Type into a switchboard line',
  description: 'Send input to a switchboard line, as if typed into its shell.',
  inputSchema: {
    id: z.string().describe('Line id'),
    text: z.string().describe('Text to send'),
    submit: z.boolean().optional().describe('Append Enter after the text (default true)'),
  },
}, async ({ id, text, submit }) => {
  try {
    await sendInput(id, text, submit !== false);
    return { content: [{ type: 'text', text: 'ok' }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `no such line, or it has ended (${e.code || e.message})` }], isError: true };
  }
});

server.registerTool('switchboard_end_line', {
  title: 'End a switchboard line',
  description: 'End a switchboard line, killing its shell.',
  inputSchema: {
    id: z.string().describe('Line id'),
  },
}, async ({ id }) => {
  const r = await rpc({ cmd: 'end', id });
  // Drop the read cursor so the entry doesn't leak for a line that will never
  // return (C1 sub-defect 1). Do this regardless of the RPC result: even a
  // failed/racy end shouldn't leave a stale cursor around for a reused id.
  forgetLine(id);
  return { content: [{ type: 'text', text: JSON.stringify(r) }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only stand up the stdio server when run directly (`node mcp-server.js`); when
// required by a test, just expose the internals below.
if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = {
  seen,
  advanceCursor,
  refreshBoot,
  forgetLine,
  BOOT_TTL_MS,
  // test seams
  __setRpc: fn => { probeRpc = fn; },
  __resetBoot: () => { boot = null; bootTs = 0; seen.clear(); },
};
