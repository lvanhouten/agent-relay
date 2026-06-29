const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { SessionManager } = require('./src/sessions');
const { createAPI } = require('./src/api');
const { createWSHub } = require('./src/ws');
const { authMiddleware } = require('./src/auth');

const PORT = process.env.PORT ?? 3001;

const app = express();
app.use(cors());
app.use(express.json());

const sessions = new SessionManager();
app.use('/api', authMiddleware, createAPI(sessions));

const server = createServer(app);
createWSHub(server, sessions);

server.listen(PORT, () => {
  console.log(`agent-relay server → http://localhost:${PORT}`);
});
