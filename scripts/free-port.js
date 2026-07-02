#!/usr/bin/env node
/**
 * Free one or more TCP ports by killing whatever process is listening on them.
 *
 * Used as a `predev` guard so a stale dev server (e.g. an orphaned `node` left
 * behind when only the npm wrapper was killed) can't block a restart with
 * EADDRINUSE. Safe by design: it targets TCP port listeners only, so the board
 * daemon (named pipes, no TCP port) is never touched.
 *
 * Usage: node scripts/free-port.js 3017 [5173 ...]
 */
const { execSync } = require('node:child_process');

const ports = process.argv.slice(2).map(Number).filter((p) => Number.isInteger(p) && p > 0);
if (ports.length === 0) process.exit(0);

const isWin = process.platform === 'win32';

function pidsForPort(port) {
  try {
    if (isWin) {
      // `-p tcp` lists IPv4 listeners only. Vite (and anything else that binds
      // the IPv6 loopback, e.g. [::1]:5173) shows up only under tcpv6 — query
      // both stacks or IPv6-only orphans survive the guard.
      const out = ['tcp', 'tcpv6']
        .map((proto) => execSync(`netstat -ano -p ${proto}`, { encoding: 'utf8' }))
        .join('\n');
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!/\bLISTENING\b/.test(line)) continue;
        // local address is the 2nd column; match it ending in :<port>
        const cols = line.trim().split(/\s+/);
        const local = cols[1] || '';
        if (local.endsWith(`:${port}`)) {
          const pid = cols[cols.length - 1];
          if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
        }
      }
      return [...pids];
    }
    const out = execSync(`lsof -ti tcp:${port} -s tcp:LISTEN`, { encoding: 'utf8' });
    return out.split(/\s+/).filter(Boolean);
  } catch {
    return []; // nothing listening, or the lookup tool isn't available
  }
}

function kill(pid) {
  try {
    execSync(isWin ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

for (const port of ports) {
  for (const pid of pidsForPort(port)) {
    if (kill(pid)) console.log(`free-port: killed pid ${pid} on :${port}`);
  }
}
