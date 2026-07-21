#!/usr/bin/env node
'use strict';
// MCP server over the switchboard board - gives an agent programmatic
// (non-pane) access to persistent PTY lines: create, read output, type input,
// end. Unlike `sb`, it never opens a terminal tab - `switchboard_read_output` /
// `switchboard_send_input` read and write the line's raw byte stream directly,
// the same seam `board-client.js` uses for the web tier. A human can still
// `sb join <id>` a real pane onto any line this creates.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { connectPipe, dataPipe, rpc } = require('./lib');
// rpc() (one control request -> one response, with a timeout) is shared from
// lib.js so its framing can't drift from sb.js / board-client.js.
// Deliberately no wait-for-idle tool: an MCP call can't run in the background
// (only Bash/Agent calls can), so a blocking wait would wedge the turn for
// minutes. Use `sb wait <id>` via a background Bash call instead (wait.js).

// The board replays full scrollback on every fresh attach; this cache tracks
// how much each line already handed back so repeat reads return only the new
// tail.
//
// Three hazards it must survive:
//  1. Board restart reuses line ids (`seq` resets to 0) - the cursor must be
//     namespaced by the boot nonce so a stale entry can't apply to a reused id.
//  2. A line's cursor must drop on exit, or it leaks forever in this
//     long-lived process.
//  3. Concurrent reads of one line share a cursor entry - updates must be
//     monotonic (never roll back and re-deliver, never jump past unseen output).
const seen = new Map(); // "<boot>:<id>" -> chars already returned
let boot = null;        // the board's current boot nonce; re-probed on a TTL
let bootTs = 0;         // when `boot` was last confirmed against a live board
const BOOT_TTL_MS = 3000; // re-probe the nonce at most this often (hot-path latency)

// Every board RPC this module makes, injectable so the cursor logic (and the
// end_line leak path) is unit-testable without a live board. Defaults to
// lib.rpc(); tests swap it via __setRpc(). Wraps every call site, not just
// refreshBoot's probe, so every RPC failure is exercisable in tests.
let boardRpc = (msg, opts) => rpc(msg, opts);

// Folds a freshly-observed boot nonce into the cache - same effect as
// refreshBoot()'s own probe, but sourced from a reply this process already got
// for another reason (every `new`/`list` reply carries the board's current
// nonce), so it costs zero extra round-trips. Called eagerly wherever the board
// hands one back, since a `new`/`list` reply is the only way a client learns of
// an id reused post-restart - refreshBoot()'s TTL fast path alone can't tell a
// live board from one that restarted inside the TTL window.
function observeBoot(freshBoot) {
  if (!freshBoot) return;
  if (freshBoot !== boot) seen.clear();
  boot = freshBoot;
  bootTs = Date.now();
}

// Pure cursor-advance decision, factored out of readOutput's finish() for
// isolated testing. Given the cache, a key (null when the board identity is
// unconfirmed - see refreshBoot), chars observed this read, and whether the
// pipe closed, returns how many chars were already delivered and mutates
// `cache` for next time:
//  - monotonic advance (never roll the cursor back and re-deliver),
//  - drop the entry only when the pipe closed (the line ended) - not on
//    content-sniffing the farewell substring, which a live echoing program
//    could trip,
//  - never read/write the cache under a null key, so a stale nonce can't
//    collide with an orphaned entry.
function advanceCursor(cache, key, textLen, pipeClosed) {
  if (!key) return 0;
  const already = cache.get(key) || 0;
  cache.set(key, Math.max(already, textLen));
  if (pipeClosed) cache.delete(key);
  return already;
}

// Learns the board's boot nonce; when it changes (a restart happened), every
// cached cursor is from a dead process and would apply to reused ids, so the
// whole cache drops.
//
// Returns { boot, confirmed } - confirmed is true only when this call (or a
// recent one inside the TTL) actually reached the board. A failed probe
// returns confirmed:false with the stale `boot`; the caller must not key the
// cursor cache off an unconfirmed nonce, since an unobserved restart plus a
// reused id plus a leaked entry would collide and silently truncate. Skips the
// round-trip while a confirmed nonce is fresh.
async function refreshBoot() {
  if (boot && Date.now() - bootTs < BOOT_TTL_MS) return { boot, confirmed: true };
  const r = await boardRpc({ cmd: 'list' }, { autostart: false }).catch(() => null);
  if (r && r.boot) { observeBoot(r.boot); return { boot, confirmed: true }; }
  return { boot, confirmed: false };
}

// Distinguishes a failed attach from a legitimately-empty read. connectPipe()
// resolves as soon as the pipe connects, before the board accepts/rejects the
// secret - so if the board tears the socket down at the handshake (rejected
// secret, restart mid-connect, vanished line), the read would otherwise resolve
// with whatever empty text arrived, indistinguishable from a quiet line. That
// false-quiet is dangerous during a secret desync: every read would silently
// return nothing instead of erroring.
//
// The tell: the pipe CLOSED with ZERO bytes ever received.
//  - A healthy quiet line keeps its socket open; our own quiet/hardStop timer
//    ends the read with pipeClosed=false - never this branch.
//  - A normal exit reaches an authed client, which always gets the farewell
//    sentinel before close, so text is non-empty - never this branch.
// Only a connection killed before we ever authed lands here, so it's an error,
// not a clean empty success.
function readClosedBeforeOutput(text, pipeClosed) {
  return pipeClosed && text.length === 0;
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
      let pipeClosed = false; // set by close/error - the line actually ended
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
        // A pipe closed before any byte arrived means the attach itself failed
        // (auth rejected, restart mid-connect, line gone), not a quiet line -
        // surface it as an error rather than an empty read. Cursor stays
        // untouched; the line may still be alive.
        if (readClosedBeforeOutput(text, pipeClosed)) {
          const err = new Error('read failed: the board closed the connection before any output (line missing, or the access secret was rejected)');
          err.code = 'EREADCLOSED';
          reject(err);
          return;
        }
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

// Drops every cursor for a line id across all boot nonces. Called on
// switchboard_end_line so the entry doesn't leak - an end with no following
// read would otherwise orphan the cursor until the next observed restart.
// Nonce-agnostic on purpose: the caller ending a line may not have a confirmed
// nonce, and stale entries under a dead nonce are exactly what should go too.
function forgetLine(id) {
  for (const key of seen.keys()) if (key.endsWith(`:${id}`)) seen.delete(key);
}

// Ends a line and drops its read cursor regardless of RPC outcome - a
// failed/racy end must not leave a stale entry for a reused id. The forget
// runs in a finally, so a rejected call (timeout, wedged board) still drops it.
async function endLine(id) {
  try {
    return await boardRpc({ cmd: 'end', id });
  } finally {
    forgetLine(id);
  }
}

// Bracketed-paste control sequences: a paste-aware program (readline/
// PSReadLine, most modern TUIs) treats everything between these markers as
// literal pasted content - embedded newlines insert rather than run.
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

// Builds the exact bytes written for a send-input call. Pure so the framing is
// unit-testable without a pipe.
//  - Default (paste:false): text verbatim plus Enter when submit - keeps a
//    multi-line value running line-by-line for callers that rely on that.
//  - paste:true: wraps the text in bracketed-paste markers so a paste-aware
//    program keeps a multi-line value as one editable block; the trailing
//    Enter (when submit) commits the whole block. Stray paste markers in text
//    are stripped first so the payload can't break the framing.
// A program that doesn't honor bracketed paste will show the literal \e[200~
// markers - paste is opt-in, per-line submit is the default.
function framePayload(text, { submit = true, paste = false } = {}) {
  const enter = submit ? '\r' : '';
  if (!paste) return text + enter;
  const clean = text.replace(/\x1b\[20[01]~/g, '');
  return PASTE_START + clean + PASTE_END + enter;
}

function sendInput(id, text, opts) {
  const payload = framePayload(text, opts);
  return new Promise((resolve, reject) => {
    connectPipe(dataPipe(id), { retries: 3, delay: 50 }).then(sock => {
      sock.write(payload, err => {
        try { sock.end(); } catch { /* already closed */ }
        if (err) reject(err); else resolve();
      });
    }, reject);
  });
}

// Fetches a line's rendered screen - a stateless snapshot over the board's
// `screen` command (unlike readOutput: no cursor, no tail/full, nothing kept
// between calls). Maps the board's reply into a snapshot or a distinguishing
// thrown error so the tool handler can surface which failure mode occurred:
//  - ok:true                -> the { grid, cursor, cols, rows } snapshot
//  - ok:false, ended:true   -> the line ran and exited (message names the exit code)
//  - ok:false, ended:false  -> no line with this id ever existed
//  - RPC itself throws/rejects (board unreachable, timeout) -> generic failure
async function readScreen(id) {
  let r;
  try {
    r = await boardRpc({ cmd: 'screen', id });
  } catch (e) {
    const err = new Error(`screen read failed: ${e.message || e.code || e}`);
    err.code = 'EREADFAILED';
    throw err;
  }
  if (r && r.ok) {
    return { grid: r.grid, cursor: r.cursor, cols: r.cols, rows: r.rows };
  }
  if (r && r.ended === true) {
    const err = new Error(`line ${id} has ended (exit ${r.exitCode})`);
    err.code = 'ELINEENDED';
    throw err;
  }
  if (r && r.ended === false) {
    const err = new Error(`no such line: ${id}`);
    err.code = 'ENOLINE';
    throw err;
  }
  // Malformed/unexpected reply shape - neither success nor a documented failure
  // mode; treated as an RPC-level failure rather than guessed at.
  const err = new Error('screen read failed: unexpected board reply');
  err.code = 'EREADFAILED';
  throw err;
}

const server = new McpServer(
  { name: 'switchboard', version: '1.0.0' },
  {
    instructions:
      `Switchboard hosts Lines: persistent shell sessions on a board that keep ` +
      `running after your tool call returns, survive Claude Code session ` +
      `restarts, and can be joined by the user (\`sb join <id>\`) at any time.\n\n` +
      `Use these tools whenever the user asks to spin up a line or (switchboard) ` +
      `session to do something, run a task in a background terminal, hand work ` +
      `to a session that outlives this one, start a claude session on a line, ` +
      `check on / monitor / read a line, send input or answer a prompt on a ` +
      `line, list the lines, or end / kill / spin down a line.\n\n` +
      `Rules that prevent the common failures:\n` +
      `- A \`switchboard_new_line\` returning without error does NOT mean the ` +
      `initial command ran - the seed input has no delivery confirmation. Read ` +
      `the line to confirm before treating it as live.\n` +
      `- \`switchboard_read_screen\` answers "what is this line showing right ` +
      `now" (stateless snapshot, re-readable). \`switchboard_read_output\` ` +
      `returns only NEW bytes since the last read - right for scrolling shells, ` +
      `useless against a full-screen TUI.\n` +
      `- Sending into a Claude Code TUI takes TWO calls: the text with ` +
      `submit:true, then a bare-Enter send ({text:"", submit:true}) to actually ` +
      `submit. Menu dialogs: bare Enter confirms the highlighted option; don't ` +
      `pick by number.\n` +
      `- When the line runs \`claude\`: clear CLAUDE_CODE_CHILD_SESSION in the ` +
      `run command first (inherited from the board; it suppresses the session's ` +
      `transcript JSONL) and pin --model/--effort explicitly. Monitor via the ` +
      `transcript JSONL under ~/.claude/projects/<cwd-slug>/ plus read_screen - ` +
      `never via read_output or PTY-idle waits, which the TUI's spinner ` +
      `defeats.\n` +
      `- Spin down a finished line gracefully: /exit the claude session ` +
      `(two-call submit), confirm the shell prompt returned, then ` +
      `switchboard_end_line. Don't leave concluded lines on the board; DO ` +
      `preserve a wedged line as evidence.\n\n` +
      `If a \`switchboard\` skill is available in the session, invoke it for the ` +
      `full spawn/monitor/teardown recipe instead of improvising from these ` +
      `notes.`,
  }
);

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
    run: z.string().optional().describe('Initial command to type into the shell once it comes up. ' +
      'When this starts a `claude` session, always pass an explicit `--model` and `--effort` sized to the ' +
      'job — e.g. `claude --model haiku --effort low "watch the build"` for a cheap watcher, ' +
      '`--model opus --effort high` for a heavy worker. (Current aliases and effort levels are the CLI\'s ' +
      'to define — see its reference; any value it accepts is fine here.) Omitting them silently inherits ' +
      'whatever the operator\'s CLI config defaults to, which is rarely the right size for a fleet line.'),
    name: z.string().optional().describe('Optional label shown in switchboard_list_lines'),
  },
}, async ({ shell, cwd, run, name }) => {
  const r = await boardRpc({ cmd: 'new', open: false, shell, cwd, run, name });
  observeBoot(r.boot);
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
  const r = await boardRpc({ cmd: 'list' }, { autostart: false }).catch(() => ({ lines: [] }));
  observeBoot(r.boot);
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
    // EREADCLOSED carries a descriptive message (socket closed before any
    // output - line missing, or secret rejected); the generic `e.code ||
    // e.message` fallback would just say "EREADCLOSED", indistinguishable from
    // a plain not-found.
    const detail = e.code === 'EREADCLOSED' ? e.message : `no such line, or it has ended (${e.code || e.message})`;
    return { content: [{ type: 'text', text: detail }], isError: true };
  }
});

server.registerTool('switchboard_read_screen', {
  title: 'Read switchboard line rendered screen',
  description: 'Read a switchboard line\'s current rendered screen — the ' +
    'terminal grid as it would appear right now, plus the cursor position and ' +
    'dimensions. Unlike switchboard_read_output (which returns the raw new ' +
    'byte-stream since the last read, letters and control codes and all), this ' +
    'is a stateless snapshot of the whole visible screen: no cursor to track, ' +
    'no tailChars/full, nothing kept between calls. Use this for an alt-screen ' +
    'TUI (a full-screen editor, a menu, `claude` itself) where the raw delta is ' +
    'mostly repaint churn and what you actually want is "what does the screen ' +
    'show right now" — use read_output for a plain scrolling shell instead.',
  inputSchema: {
    id: z.string().describe('Line id, from switchboard_new_line or switchboard_list_lines'),
  },
}, async ({ id }) => {
  try {
    const snapshot = await readScreen(id);
    return { content: [{ type: 'text', text: JSON.stringify(snapshot) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
});

server.registerTool('switchboard_send_input', {
  title: 'Type into a switchboard line',
  description: 'Send input to a switchboard line, as if typed into its shell. By ' +
    'default a multi-line text runs line by line (each newline submits), which is ' +
    'what you want for a sequence of commands. To enter a multi-line value as one ' +
    'block instead — a heredoc body, a code snippet into a REPL, a command you ' +
    'want to review before it runs — set paste:true, which wraps it in ' +
    'bracketed-paste markers so the receiving program keeps the newlines literal. ' +
    'paste only works if that program supports bracketed paste (modern shells and ' +
    'TUIs do); a program that does not will show literal \\e[200~ markers, so ' +
    'leave paste off unless you specifically need block entry.',
  inputSchema: {
    id: z.string().describe('Line id'),
    text: z.string().describe('Text to send'),
    submit: z.boolean().optional().describe('Append Enter after the text (default true)'),
    paste: z.boolean().optional().describe('Wrap the text in bracketed-paste markers so a multi-line value arrives as one block instead of running line by line (default false)'),
  },
}, async ({ id, text, submit, paste }) => {
  try {
    await sendInput(id, text, { submit: submit !== false, paste: paste === true });
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
  const r = await endLine(id);
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
  readClosedBeforeOutput,
  refreshBoot,
  observeBoot,
  forgetLine,
  endLine,
  readScreen,
  framePayload,
  BOOT_TTL_MS,
  // test seams
  __setRpc: fn => { boardRpc = fn; },
  __resetBoot: () => { boot = null; bootTs = 0; seen.clear(); },
};
