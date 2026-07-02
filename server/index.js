const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { BoardSessions } = require('./src/sessions');
const { createAPI } = require('./src/api');
const { createWSHub } = require('./src/ws');
const { authMiddleware, TOKEN, TOKEN_GENERATED } = require('./src/auth');
const { originAllowed } = require('./src/origin');
const { errorHandler } = require('./src/errorHandler');

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
app.use('/api', authMiddleware, createAPI(sessions));

// Final error handler. Without it, Express's default handler leaks the full stack
// trace in the response body whenever NODE_ENV isn't 'production' (the default
// here). Log server-side, return a generic body — a board-unreachable failure is
// a transient 503, anything else a generic 500 with no internal detail. Shared
// with api.test.js (./src/errorHandler.js) so the two can't drift.
app.use(errorHandler);

const server = createServer(app);
createWSHub(server, sessions);

server.listen(PORT, () => {
  console.log(`agent-relay server → http://localhost:${PORT}`);
  if (TOKEN_GENERATED) {
    console.log(
      `\nAR_TOKEN not set — generated an access token for this run:\n\n  ${TOKEN}\n\n` +
      `Paste it into the login screen. Set AR_TOKEN to pin a stable token,\n` +
      `or AR_NO_AUTH=1 to disable auth entirely (dev only — an open relay\n` +
      `executes commands for any page your browser visits).\n`
    );
  }
});

// Release the port on catchable stops (Ctrl+C, SIGTERM). A hard external
// terminate (e.g. the harness killing the npm wrapper) can't be caught here —
// the `predev` free-port guard reclaims the port on the next start instead.
let closing = false;
const shutdown = (signal) => {
  if (closing) return;
  closing = true;
  console.log(`\n${signal} → closing server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref(); // force-exit if close hangs on open sockets
};
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));
