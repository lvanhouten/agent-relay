'use strict';
const { WebSocketServer } = require('ws');
const { parse } = require('url');
const { StringDecoder } = require('string_decoder');
const { checkToken } = require('./auth');

function createWSHub(server, sessions) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', async (ws, req) => {
    const parsed = parse(req.url, true);
    const id = (parsed.pathname ?? '').split('/').filter(Boolean).pop();

    if (!checkToken(parsed.query.token)) { ws.close(1008, 'unauthorized'); return; }
    if (!id) { ws.close(1008, 'session not found'); return; }

    // Distinguish "board unreachable" from "session not found": a board hiccup
    // (restart, pipe error) must NOT make a live session look permanently gone.
    // 1013 (Try Again Later) is transient, so the client keeps reconnecting;
    // 1008 (session not found) is permanent and stops the retry loop.
    let existing;
    try {
      existing = await sessions.get(id);
    } catch (e) {
      if (e && e.boardUnreachable) { ws.close(1013, 'board unreachable'); return; }
      ws.close(1011, 'session lookup failed'); return;
    }
    if (!existing) { ws.close(1008, 'session not found'); return; }

    // Attach to the board line. Scrollback replays down the data pipe on connect,
    // so there's no separate history step. Decode raw bytes -> string for the client.
    const decoder = new StringDecoder('utf8');
    let handle = null, closed = false;
    ws.on('close', () => { closed = true; if (handle) handle.detach(); });

    try {
      handle = await sessions.attach(id, {
        onData: buf => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'data', payload: decoder.write(buf) })); },
        onExit: code => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit', code })); },
      });
    } catch {
      if (ws.readyState === 1) ws.close(1011, 'attach failed');
      return;
    }
    if (closed) { handle.detach(); return; }   // WS dropped while we were attaching

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'input') handle.write(msg.payload);
        if (msg.type === 'resize') handle.resize(msg.cols, msg.rows);
      } catch { /* malformed message — ignore */ }
    });
  });
}

module.exports = { createWSHub };
