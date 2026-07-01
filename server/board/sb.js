#!/usr/bin/env node
'use strict';
// switchboard CLI — new / list / join / end / wait on lines.
const { connectControl } = require('./lib');
const { detectSpawner } = require('./spawners');

// Detect the caller's terminal here (the board can't — it's detached) and pass
// the launch recipe along so the board opens the tab in *this* terminal.
function spawnRecipe() {
  const r = detectSpawner();
  if (!r) {
    console.error('switchboard: could not detect your terminal — set ' +
      'SWITCHBOARD_TERM="<term> -e {cmd}" to auto-open tabs (line still started; join it manually)');
  }
  return r || undefined;
}

// One request, one response.
async function rpc(msg, { autostart = true } = {}) {
  const sock = await connectControl({ autostart });
  return new Promise((resolve, reject) => {
    let buf = '';
    sock.on('data', d => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i >= 0) { sock.end(); resolve(JSON.parse(buf.slice(0, i))); }
    });
    sock.on('error', reject);
    sock.write(JSON.stringify(msg) + '\n');
  });
}

const HELP = `switchboard — a PTY exchange for your terminal

usage:
  sb up             bring the board online
  sb new [shell] [--run <cmd>]
                    start a new line + join a tab (e.g. sb new --run claude)
  sb list           list active lines
  sb join <id>      join a new tab to an existing line
  sb end <id>       end a line
  sb wait <id> [idleMs] [maxWaitMs]
                    block until the line goes quiet or exits (default 12s idle,
                    10min cap) — backgroundable via your shell's own job control,
                    unlike an MCP tool call
  sb down           take the board offline (ends every line)
  sb help           show this help`;

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const arg = args[1];
  switch (cmd) {
    case 'up': {
      const sock = await connectControl();
      sock.end();
      console.log('switchboard online');
      break;
    }
    case 'new': {
      // sb new [shell] [--run <cmd>] — optional shell, optional initial command
      // typed into the shell (which stays open), mirroring the web client.
      const rest = args.slice(1);
      let shell, run;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--run' || rest[i] === '-r') run = rest[++i];
        else if (!shell && !rest[i].startsWith('-')) shell = rest[i];
      }
      const msg = { cmd: 'new', open: true, cwd: process.cwd(), spawn: spawnRecipe() };
      if (shell) msg.shell = shell;
      if (run) msg.run = run;
      const r = await rpc(msg);
      console.log(`line ${r.id} started${run ? ` (running: ${run})` : ''} — joining a tab`);
      break;
    }
    case 'list':
    case 'ls': {
      const r = await rpc({ cmd: 'list' }, { autostart: false }).catch(() => null);
      if (!r || !r.lines.length) { console.log('no active lines'); break; }
      console.log(['ID', 'PID', 'SHELL', 'JOINED', 'UPTIME'].join('\t'));
      for (const l of r.lines) {
        console.log([l.id, l.pid, l.shell, l.joined, Math.round(l.uptimeMs / 1000) + 's'].join('\t'));
      }
      break;
    }
    case 'down': {
      const r = await rpc({ cmd: 'shutdown' }, { autostart: false }).catch(() => null);
      console.log(r ? `board offline (ended ${r.dropped} line${r.dropped === 1 ? '' : 's'})` : 'board was not running');
      break;
    }
    case 'join': {
      if (!arg) { console.error('usage: sb join <id>'); process.exit(1); }
      const r = await rpc({ cmd: 'join', id: arg, spawn: spawnRecipe() });
      console.log(r.ok ? `joining a tab to line ${arg}` : `no such line: ${arg}`);
      break;
    }
    case 'end': {
      if (!arg) { console.error('usage: sb end <id>'); process.exit(1); }
      const r = await rpc({ cmd: 'end', id: arg });
      console.log(r.ok ? `line ${arg} ended` : `no such line: ${arg}`);
      break;
    }
    case 'wait': {
      if (!arg) { console.error('usage: sb wait <id> [idleMs] [maxWaitMs]'); process.exit(1); }
      const { waitForIdleOrExit } = require('./wait');
      const idleMs = args[2] ? Number(args[2]) : undefined;
      const maxWaitMs = args[3] ? Number(args[3]) : undefined;
      const r = await waitForIdleOrExit(arg, { idleMs, maxWaitMs });
      console.log(JSON.stringify(r));
      break;
    }
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;
    default:
      console.log(HELP);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
