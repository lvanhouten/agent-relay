const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { BoardSessions } = require('./src/sessions');
const { createAPI } = require('./src/api');
const { createWSHub } = require('./src/ws');
const { authMiddleware } = require('./src/auth');

const PORT = process.env.PORT ?? 3017;   // 3001 collides with VS Code on some machines

const app = express();
app.use(cors());
app.use(express.json());

const sessions = new BoardSessions();
app.use('/api', authMiddleware, createAPI(sessions));

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
