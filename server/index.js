const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { BoardSessions } = require('./src/sessions');
const { createAPI } = require('./src/api');
const { createWSHub } = require('./src/ws');
const { authMiddleware } = require('./src/auth');
const { errorHandler } = require('./src/errorHandler');

const PORT = process.env.PORT ?? 3017;   // 3001 collides with VS Code on some machines

const app = express();
// CORS. By default (unset) we reflect any origin — fine for the same-origin
// localhost deployment this tool ships as. Set AR_CORS_ORIGIN (comma-separated)
// to restrict to an allowlist once the port is tunneled/exposed, so an arbitrary
// page the operator visits can't issue cross-origin requests to /api.
const CORS_ORIGIN = process.env.AR_CORS_ORIGIN;
app.use(cors(CORS_ORIGIN
  ? { origin: CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean) }
  : undefined));
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
