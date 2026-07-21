#!/usr/bin/env node
'use strict';
// switchboard CLI - new / list / join / end / wait on lines.
const path = require('path');
const { spawn } = require('child_process');
const { connectControl, rpc } = require('./lib');
const { detectSpawner } = require('./spawners');

// Detect the caller's terminal here (the board can't - it's detached) and pass
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
  sb new [shell] [--run <cmd>] [--here]
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
  sb help           show this help

Run \`sb <command> -h\` for a command's full arguments.`;

// Per-command help, shown for `sb <cmd> -h` / `--help`. Each lists every arg
// and flag the command accepts.
const USAGE = {
  up: `sb up — bring the board online

  Starts the board daemon if it isn't already running, then exits. No args.`,
  new: `sb new [shell] [--run <cmd>] [--here] — start a new line

  shell           optional shell to launch (default: the board's own default)
  --run, -r <cmd> initial command typed into the shell once it's up; the shell
                  stays open afterward (e.g. sb new --run claude)
  --here, --inline attach THIS terminal to the new line instead of opening a new
                  tab; blocks until you press Ctrl+] to detach (line keeps running)

  Without --here, a new tab is opened in your terminal (needs a detectable
  terminal or SWITCHBOARD_TERM).`,
  list: `sb list  (alias: sb ls) — list active lines

  Prints one row per live line (ID, PID, SHELL, JOINED, UPTIME). No args.`,
  ls: null, // aliased to list below
  join: `sb join <id> [--here] — join an existing line

  <id>            the line id to join (see \`sb list\`)
  --here, --inline attach THIS terminal instead of opening a new tab; blocks
                  until you press Ctrl+] to detach (line keeps running)

  Without --here, a new tab is opened in your terminal.`,
  end: `sb end <id> — end a line

  <id>            the line id to end. The line's process is killed.`,
  screen: `sb screen <id> — print a line's current rendered screen

  <id>            the line id whose rendered terminal grid to print (a one-shot
                  snapshot; no read cursor).`,
  wait: `sb wait <id> [idleMs] [maxWaitMs] — block until a line goes quiet or exits

  <id>            the line id to wait on
  idleMs          quiet threshold in ms before the line counts as idle
                  (default: ~12s)
  maxWaitMs       hard cap in ms before giving up (default: 10min)

  Prints a JSON result. Backgroundable via your shell's own job control.`,
  down: `sb down — take the board offline

  Ends every line and stops the board daemon. No args.`,
};
USAGE.ls = USAGE.list;

// Parses `sb new` args: optional leading shell, --run/-r <cmd>, --here/--inline.
// Shell-naive by design (mirrors the create dialog) - first non-flag token is
// the shell; flags may appear in any order.
function parseNewArgs(rest) {
  let shell, run, here = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--run' || rest[i] === '-r') run = rest[++i];
    else if (rest[i] === '--here' || rest[i] === '--inline') here = true;
    else if (!shell && !rest[i].startsWith('-')) shell = rest[i];
  }
  return { shell, run, here };
}

// patch.js in-process against a line id: attaches THIS terminal to the line
// (stdio inherited), Ctrl+] (29) detaches back to this shell, line keeps running.
function joinHere(id) {
  console.log(`joining line ${id} in this terminal — press Ctrl+] to detach`);
  const child = spawn(process.execPath, [path.join(__dirname, 'patch.js'), id, '29'], { stdio: 'inherit' });
  child.on('exit', code => process.exit(code == null ? 0 : code));
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const arg = args[1];
  // `sb <cmd> -h` / `--help` prints that command's full arg list, when the flag
  // follows a known command (a bare `sb -h` still falls to the top-level HELP).
  if (USAGE[cmd] && (args.slice(1).includes('-h') || args.slice(1).includes('--help'))) {
    console.log(USAGE[cmd]);
    return;
  }
  switch (cmd) {
    case 'up': {
      const sock = await connectControl();
      sock.end();
      console.log('switchboard online');
      break;
    }
    case 'new': {
      // sb new [shell] [--run <cmd>] - optional shell, optional initial command
      // typed into the shell (which stays open), mirroring the web client.
      const { shell, run, here } = parseNewArgs(args.slice(1));
      // --here attaches this terminal instead of opening a new tab: create the
      // line with open:false (no pane recipe), then patch in-process - mirroring
      // `sb join --here`. The `run` command still feeds through the board.
      const msg = here
        ? { cmd: 'new', open: false, cwd: process.cwd() }
        : { cmd: 'new', open: true, cwd: process.cwd(), spawn: spawnRecipe() };
      if (shell) msg.shell = shell;
      if (run) msg.run = run;
      const r = await rpc(msg);
      const started = `line ${r.id} started${run ? ` (running: ${run})` : ''}`;
      if (here) { joinHere(r.id); break; }
      // paneOpened === false means the board refused the launch recipe (no
      // standalone {cmd} arg) - the line exists but no tab will appear, so say so
      // instead of the misleading "joining a tab".
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
      // board opens no pane - client registration happens when patch connects to
      // the data pipe, so no `join` RPC is needed. Blocks until detach/exit.
      if (args.slice(2).includes('--here') || args.slice(2).includes('--inline')) {
        joinHere(arg);
        break;
      }
      const r = await rpc({ cmd: 'join', id: arg, spawn: spawnRecipe() });
      if (!r.ok) { console.log(`no such line: ${arg}`); break; }
      // A refused recipe (paneOpened === false) means no tab opened despite
      // ok:true - surface it rather than claim success.
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

if (require.main === module) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { parseNewArgs };
