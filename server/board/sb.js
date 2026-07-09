#!/usr/bin/env node
'use strict';
// switchboard CLI — new / list / join / end / wait on lines.
const path = require('path');
const { spawn } = require('child_process');
const { connectControl, rpc } = require('./lib');
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

// rpc() (one control request -> one response, with a timeout) is shared from
// lib.js so its framing can't drift from board-client.js / mcp-server.js.

const HELP = `switchboard — a PTY exchange for your terminal

usage:
  sb up             bring the board online
  sb new [shell] [--run <cmd>]
                    start a new line + join a tab (e.g. sb new --run claude)
  sb list           list active lines
  sb join <id> [--here]
                    join an existing line — a new tab by default, or the
                    current terminal with --here (blocks until you detach)
  sb end <id>       end a line
  sb screen <id>    print a line's current rendered screen
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
      // paneOpened === false means the board refused the launch recipe (no
      // standalone {cmd} arg) — the line exists but no tab will appear, so say so
      // instead of the misleading "joining a tab" (N7/new-N1).
      const started = `line ${r.id} started${run ? ` (running: ${run})` : ''}`;
      console.log(r.paneOpened === false
        ? `${started} — could NOT open a tab (check SWITCHBOARD_TERM); join it manually with \`sb join ${r.id}\``
        : `${started} — joining a tab`);
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
      if (!arg) { console.error('usage: sb join <id> [--here]'); process.exit(1); }
      // --here attaches this terminal to the line instead of opening a new tab:
      // run patch.js (the same raw relay a spawned pane runs) in-process. The
      // board opens no pane — client registration happens when patch connects to
      // the data pipe, so no `join` RPC is needed. Blocks until detach/exit.
      if (args.slice(2).includes('--here') || args.slice(2).includes('--inline')) {
        // Ctrl+] (29) detaches back to this shell; the line keeps running.
        console.log(`joining line ${arg} in this terminal — press Ctrl+] to detach`);
        const child = spawn(process.execPath, [path.join(__dirname, 'patch.js'), arg, '29'], { stdio: 'inherit' });
        child.on('exit', code => process.exit(code == null ? 0 : code));
        break;
      }
      const r = await rpc({ cmd: 'join', id: arg, spawn: spawnRecipe() });
      if (!r.ok) { console.log(`no such line: ${arg}`); break; }
      // A refused recipe (paneOpened === false) means no tab opened despite ok:true
      // — surface it rather than claim success (N7/new-N1).
      console.log(r.paneOpened === false
        ? `line ${arg} exists but a tab could NOT be opened (check SWITCHBOARD_TERM)`
        : `joining a tab to line ${arg}`);
      break;
    }
    case 'end': {
      if (!arg) { console.error('usage: sb end <id>'); process.exit(1); }
      const r = await rpc({ cmd: 'end', id: arg });
      console.log(r.ok ? `line ${arg} ended` : `no such line: ${arg}`);
      break;
    }
    case 'screen': {
      if (!arg) { console.error('usage: sb screen <id>'); process.exit(1); }
      const r = await rpc({ cmd: 'screen', id: arg });
      if (!r.ok) {
        console.log(r.ended ? `line ${arg} has ended (exit ${r.exitCode})` : `no such line: ${arg}`);
        break;
      }
      console.log(r.grid);
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
