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
// CORS: reflect the request's origin only when the shared origin policy allows
// it (loopback, same-origin, or the AR_CORS_ORIGIN allowlist — see
// src/origin.js). Any other page gets no ACAO headers, so its preflights fail
// and its responses are unreadable. The WS upgrade enforces the same policy in
// ws.js, since CORS never applied to WebSockets.
app.use(cors((req, cb) => cb(null, { origin: originAllowed(req.headers.origin, req.headers.host) })));
app.use(express.json());

const sessions = new BoardSessions();
// Push-notification sinks (Pushover today). Absent config -> empty list ->
// POST /api/notify still flags the card but fans out to nobody (feature off).
const notifiers = resolveNotifiers(process.env);
// AR_NOTIFY_URL_ORIGIN: the one origin /api/notify's `url` deep link may point
// at (unset -> the field is rejected; see validateNotifyUrl in api.js).
app.use('/api', authMiddleware, createAPI(sessions, notifiers, { notifyUrlOrigin: process.env.AR_NOTIFY_URL_ORIGIN }));

// Tunnel supervisor — created unconditionally so the pairing router always has a
// stable status() getter. With AR_TUNNEL unset it sits in the 'disabled' state and
// start() is a no-op; with AR_TUNNEL=tailscale it drives `tailscale serve` and
// degrades to local-only on any precondition failure (never throws, never exits).
// onEvent turns the supervisor's lifecycle into console output (below).
const tunnel = createTunnel({ port: PORT, onEvent: printTunnelEvent });

// Pairing endpoints (POST /api/login, GET /api/pairing) mounted behind the same
// dual-auth gate as the API router, matching its mount shape. The router applies
// no auth of its own. Cookie collaborators + the tunnel status getter are injected.
app.use('/api', authMiddleware, createPairing({
  token: TOKEN,
  checkToken,
  issue,
  setCookieHeader,
  signingSecret: SIGNING_SECRET,
  tunnelStatus: tunnel.status,
}));

// Serve the built client (client/dist) from this port — the production story:
// same origin for page, API, and WS, no Vite proxy. Unauthenticated on purpose
// (the login page must load before there's a token). Mounted after /api so API
// routes win; its SPA fallback excludes /api and /sessions. No build → dev mode,
// where Vite owns the page.
const staticRouter = createStatic();
if (staticRouter) app.use(staticRouter);

// Final error handler. Without it, Express's default handler leaks the full stack
// trace in the response body whenever NODE_ENV isn't 'production' (the default
// here). Log server-side, return a generic body — a board-unreachable failure is
// a transient 503, anything else a generic 500 with no internal detail. Shared
// with api.test.js (./src/errorHandler.js) so the two can't drift.
app.use(errorHandler);

const server = createServer(app);
createWSHub(server, sessions);

// Turn the tunnel supervisor's lifecycle events into console output. On 'up' we
// register the discovered tailnet origin with the origin policy (so the tunneled
// page passes the CORS/WS gate regardless of Host-header passthrough) and print
// the pairing block + a scannable QR encoding the pairing URL (token in the URL
// FRAGMENT — never a query string). 'degraded' prints a single block naming the
// precondition + fix; 'retry' logs a terse respawn line (visible, not spammy).
function printTunnelEvent(event) {
  if (event.type === 'up') {
    allowRuntimeOrigin(event.url);
    // Same single formatter the GET /api/pairing response uses — token in the
    // URL FRAGMENT, never a query string (src/pairing.js pairingUrl()).
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
  if (TOKEN_GENERATED) {
    console.log(
      `\nAR_TOKEN not set — generated an access token (persisted across runs):\n\n  ${TOKEN}\n\n` +
      `Paste it into the login screen. Set AR_TOKEN to pin a stable token,\n` +
      `or AR_NO_AUTH=1 to disable auth entirely (dev only — an open relay\n` +
      `executes commands for any page your browser visits).\n`
    );
  }
  // Start the tunnel after the local listener is up so its console block follows
  // the local URL. No-op when AR_TUNNEL is unset (supervisor 'disabled' state);
  // any failure degrades to local-only via the 'degraded' event above.
  tunnel.start();
});

// Release the port on catchable stops (Ctrl+C, SIGTERM). A hard external
// terminate (e.g. the harness killing the npm wrapper) can't be caught here —
// the `predev` free-port guard reclaims the port on the next start instead.
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
