const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode-terminal');
const { createServer } = require('http');
const { BoardSessions } = require('./src/sessions');
const { createAPI } = require('./src/api');
const { createWSHub } = require('./src/ws');
const { authMiddleware, checkToken, TOKEN, TOKEN_GENERATED, SIGNING_SECRET } = require('./src/auth');
const { originAllowed, allowRuntimeOrigin } = require('./src/origin');
const { issue, setCookieHeader } = require('./src/cookie');
const { createPairing, pairingUrl } = require('./src/pairing');
const { createTunnel } = require('./src/tunnel');
const { errorHandler } = require('./src/errorHandler');
const { createStatic } = require('./src/static');
const { resolveNotifiers } = require('./src/notifiers');

const PORT = process.env.PORT ?? 3017;   // 3001 collides with VS Code on some machines

const app = express();
// Reflects the origin only when src/origin.js's policy allows it (loopback,
// same-origin, or AR_CORS_ORIGIN); ws.js enforces the same policy for WS upgrades.
app.use(cors((req, cb) => cb(null, { origin: originAllowed(req.headers.origin, req.headers.host) })));
app.use(express.json());

const sessions = new BoardSessions();
// Push sinks (Pushover today); empty config = card still flags but notifies nobody.
const notifiers = resolveNotifiers(process.env);
// AR_NOTIFY_URL_ORIGIN: the one origin /api/notify's `url` may target (unset ->
// the field is rejected; see validateNotifyUrl in api.js).
app.use('/api', authMiddleware, createAPI(sessions, notifiers, { notifyUrlOrigin: process.env.AR_NOTIFY_URL_ORIGIN }));

// Created unconditionally so pairing always has a status() getter; AR_TUNNEL unset
// -> 'disabled' state, start() no-ops. On any precondition failure it degrades to
// local-only, never throws/exits. onEvent turns its lifecycle into console output.
const tunnel = createTunnel({ port: PORT, onEvent: printTunnelEvent });

// Pairing endpoints mounted behind the same dual-auth gate as the API router (it
// applies no auth of its own). Cookie collaborators + the tunnel status getter injected.
app.use('/api', authMiddleware, createPairing({
  token: TOKEN,
  checkToken,
  issue,
  setCookieHeader,
  signingSecret: SIGNING_SECRET,
  tunnelStatus: tunnel.status,
}));

// Serves the built client from this port (same origin as API/WS, no Vite proxy in
// prod). Unauthenticated on purpose — the login page must load before there's a
// token. Mounted after /api so API routes win; a new top-level route namespace
// added here (e.g. /healthz) MUST also join static.js's RESERVED_PREFIXES, or the
// SPA fallback answers its unknown paths with index.html. No build -> dev mode.
const staticRouter = createStatic();
if (staticRouter) app.use(staticRouter);

// Without this, Express's default handler leaks the stack trace whenever
// NODE_ENV isn't 'production'. Shared with errorHandler.test.js so it can't drift.
app.use(errorHandler);

const server = createServer(app);
createWSHub(server, sessions);

// Turns tunnel lifecycle events into console output. On 'up', registers the
// tailnet origin (so a tunneled page passes CORS/WS regardless of Host-header
// passthrough) and prints the pairing QR (token in the URL fragment, never a
// query string — src/pairing.js pairingUrl()). 'degraded' names the precondition
// + fix; 'retry' logs a terse respawn line.
function printTunnelEvent(event) {
  if (event.type === 'up') {
    allowRuntimeOrigin(event.url);
    const url = pairingUrl(event.url, TOKEN);
    console.log(`\n=== Tunnel up ===`);
    console.log(`  reachable from your tailnet at ${event.url}`);
    console.log(`  Pair a device — scan this QR (opens the app already signed in):\n`);
    qrcode.generate(url, { small: true });
    return;
  }
  if (event.type === 'degraded') {
    console.log(`\n=== Tunnel not started (relay running local-only) ===`);
    console.log(`  ${event.reason}`);
    console.log(
      `  One-time tailnet setup for \`tailscale serve\`: enable MagicDNS and HTTPS\n` +
      `  certificates on your tailnet (admin console → DNS, then HTTPS Certificates).`
    );
    console.log(`  The relay remains fully usable on localhost.`);
    return;
  }
  if (event.type === 'retry') {
    console.log(`tunnel: process ${event.reason} — retrying in ${event.delayMs}ms (attempt ${event.attempt})`);
    return;
  }
}

server.listen(PORT, () => {
  console.log(`agent-relay server → http://localhost:${PORT}`);
  console.log(staticRouter
    ? '  serving client build (client/dist)'
    : '  no client build — UI via Vite dev server (npm run client); build with `npm run build --workspace=client`');
  console.log(TOKEN
    ? '  auth on — an access token (bearer) or auth cookie is required'
    : '  auth DISABLED (AR_NO_AUTH=1) — dev only; an open relay executes commands for any page your browser visits');
  console.log(notifiers.length
    ? `  push notifications: ${notifiers.map((n) => n.name).join(', ')} (POST /api/notify)`
    : '  push notifications: off (set AR_PUSHOVER_TOKEN + AR_PUSHOVER_USER to enable)');
  if (TOKEN) {
    console.log(
      TOKEN_GENERATED
        ? `\nAR_TOKEN not set — generated an access token (persisted across runs):\n\n  ${TOKEN}\n\n` +
          `Paste it into the login screen. Set AR_TOKEN to pin a stable token,\n` +
          `or AR_NO_AUTH=1 to disable auth entirely (dev only — an open relay\n` +
          `executes commands for any page your browser visits).\n`
        : `\nAR_TOKEN set — using the pinned access token:\n\n  ${TOKEN}\n\n` +
          `Paste it into the login screen.\n`
    );
  }
  // Start after the local listener is up, so its console block follows the local
  // URL; no-op if AR_TUNNEL is unset, any failure degrades via the 'degraded' event.
  tunnel.start();
});

// Releases the port on catchable stops only (Ctrl+C, SIGTERM) — a hard external
// terminate can't be caught here; the `predev` free-port guard reclaims it instead.
let closing = false;
const shutdown = (signal) => {
  if (closing) return;
  closing = true;
  console.log(`\n${signal} → closing server`);
  tunnel.stop(); // kill any `tailscale serve` child + cancel pending respawns before we go
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref(); // force-exit if close hangs on open sockets
};
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));
