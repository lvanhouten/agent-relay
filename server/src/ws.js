const { WebSocketServer } = require('ws');
const { parse } = require('url');
const { checkToken } = require('./auth');

function createWSHub(server, sessions) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const parsed = parse(req.url, true);
    const pathname = parsed.pathname ?? '';
    const id = pathname.split('/').filter(Boolean).pop();

    if (!checkToken(parsed.query.token)) {
      ws.close(1008, 'unauthorized');
      return;
    }

    if (!id || !sessions.get(id)) {
      ws.close(1008, 'session not found');
      return;
    }

    // replay scrollback so reconnecting clients see history
    const history = sessions.scrollback(id).join('');
    if (history) ws.send(JSON.stringify({ type: 'data', payload: history }));

    const onData = (sid, data) => {
      if (sid === id && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'data', payload: data }));
      }
    };
    const onExit = (sid, code) => {
      if (sid === id && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'exit', code }));
      }
    };

    sessions.on('data', onData);
    sessions.on('exit', onExit);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'input') sessions.write(id, msg.payload);
        if (msg.type === 'resize') sessions.resize(id, msg.cols, msg.rows);
      } catch { /* malformed message — ignore */ }
    });

    ws.on('close', () => {
      sessions.off('data', onData);
      sessions.off('exit', onExit);
    });
  });
}

module.exports = { createWSHub };
