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
const { connectControl, connectPipe, dataPipe } = require('./lib');

function rpc(msg, opts) {
  return new Promise((resolve, reject) => {
    connectControl(opts).then(sock => {
      let buf = '';
      sock.on('data', d => {
        buf += d;
        const i = buf.indexOf('\n');
        if (i >= 0) { sock.end(); resolve(JSON.parse(buf.slice(0, i))); }
      });
      sock.on('error', reject);
      sock.write(JSON.stringify(msg) + '\n');
    }, reject);
  });
}

// The board always replays its full scrollback to a fresh attach. We track how
// much of that stream each line has already handed back so repeat reads return
// only the new tail instead of the whole buffer every time.
const seen = new Map(); // id -> chars already returned

const DEFAULT_TAIL_CHARS = 4000;

function readOutput(id, { waitMs = 400, maxWaitMs = 3000, tailChars = DEFAULT_TAIL_CHARS, full = false } = {}) {
  return new Promise((resolve, reject) => {
    connectPipe(dataPipe(id), { retries: 3, delay: 50 }).then(sock => {
      let text = '';
      let quiet = null;
      let finished = false;
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
        const already = seen.get(id) || 0;
        seen.set(id, text.length); // advance the cursor even if we only hand back the tail below
        const delta = text.slice(already);
        if (full || delta.length <= tailChars) { resolve(delta); return; }
        const dropped = delta.length - tailChars;
        resolve(`[switchboard: showing last ${tailChars} of ${delta.length} new chars — ${dropped} earlier chars dropped; pass full:true to switchboard_read_output to see everything]\n` + delta.slice(-tailChars));
      }
      sock.on('data', d => { text += d.toString('utf8'); arm(); });
      sock.on('error', finish);
      sock.on('close', finish);
      arm();
    }, reject);
  });
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
  return { content: [{ type: 'text', text: JSON.stringify(r) }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(e => { console.error(e); process.exit(1); });
