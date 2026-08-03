'use strict';
const { WebSocketServer } = require('ws');
const { parse } = require('url');
const { StringDecoder } = require('string_decoder');
const { isAuthenticated, TOKEN, SIGNING_SECRET } = require('./auth');
const { originAllowed } = require('./origin');

// Initial spectator state from `?mode=spectator` (set by the desktop grid's watch
// panes; scoped tokens will later derive it from token scope, reusing this gate).
// The grid flips it live via a `mode` frame so a focus change never reattaches. A
// spectator's input/resize frames are dropped, not errored, and its control
// socket closes so it leaves the board's resize clamp.
function initialSpectator(query) {
  return query.mode === 'spectator';
}

// authConfig is injectable for tests (same reason as auth.makeAuthMiddleware —
// the module credentials aren't otherwise overridable); real callers omit it and
// get the module TOKEN/SIGNING_SECRET.
function createWSHub(server, sessions, authConfig = {}) {
  const expectedToken = 'expectedToken' in authConfig ? authConfig.expectedToken : TOKEN;
  const signingSecret = 'signingSecret' in authConfig ? authConfig.signingSecret : SIGNING_SECRET;
  const wss = new WebSocketServer({ server });

  wss.on('connection', async (ws, req) => {
    const parsed = parse(req.url, true);
    const id = (parsed.pathname ?? '').split('/').filter(Boolean).pop();

    // Both listeners are registered in this first synchronous block, before any
    // await below. A client sends `mode` + its fitted `resize` the moment it sees
    // the 101 — well inside the board RPCs that follow — and `ws` emits 'message'
    // with no listener attached, dropping the frame outright: no queue, no
    // redelivery. That left the PTY at its pre-attach size, so a TUI kept drawing
    // for the wrong grid until the operator resized the window by hand. `close`
    // has the same exposure: it sets the flag the post-attach guard reads.
    // The queue is capped — the window is milliseconds, but it opens before the
    // credential gate below, so an unauthenticated peer must not be able to grow it.
    const PREATTACH_FRAME_CAP = 64;
    const buffered = [];
    let deliver = raw => { if (buffered.length < PREATTACH_FRAME_CAP) buffered.push(raw); };
    let handle = null, closed = false;
    ws.on('message', raw => deliver(raw));
    ws.on('close', () => { closed = true; if (handle) handle.detach(); });

    // Origin gate first — CORS never applies to WebSockets, so without this any
    // page the browser visits could open a socket to a line. Same policy as REST
    // (src/origin.js); non-browser clients send no Origin and pass through.
    let spectator = initialSpectator(parsed.query);
    if (!originAllowed(req.headers.origin, req.headers.host)) { ws.close(1008, 'forbidden origin'); return; }
    // Either credential: the `?token=` query param (non-browser clients) or a
    // valid auth cookie on the upgrade headers (browsers) — same shared decision
    // as the REST middleware.
    if (!isAuthenticated({ token: parsed.query.token, cookieHeader: req.headers.cookie, expectedToken, signingSecret })) { ws.close(1008, 'unauthorized'); return; }
    if (!id) { ws.close(1008, 'session not found'); return; }

    // Distinguishes "board unreachable" from "session not found": a board
    // hiccup must not make a live session look permanently gone. 1013 (Try Again
    // Later) is transient so the client keeps reconnecting; 1008 is permanent.
    let existing;
    try {
      existing = await sessions.get(id);
    } catch (e) {
      if (e && e.boardUnreachable) { ws.close(1013, 'board unreachable'); return; }
      // Log before the 1011 close — unlike the expected board-unreachable case,
      // an unexpected lookup failure would otherwise leave nothing to grep for.
      console.error('[ws] session lookup failed:', e && e.message ? e.message : e);
      ws.close(1011, 'session lookup failed'); return;
    }
    if (!existing) { ws.close(1008, 'session not found'); return; }
    // A tombstone (recently-ended line) is listed but not attachable — its data
    // pipe is gone. Same permanent close code as "not found".
    if (existing.status === 'exited') { ws.close(1008, 'session exited'); return; }

    // Scrollback replays down the data pipe on connect, so there's no separate
    // history step. Decode raw bytes -> string for the client.
    const decoder = new StringDecoder('utf8');

    try {
      handle = await sessions.attach(id, {
        spectator,
        onData: buf => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'data', payload: decoder.write(buf) })); },
        onExit: code => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit', code })); },
      });
    } catch (e) {
      // TOCTOU: the line can end between the existence check and attach — then
      // the data pipe is gone and connectPipe rejects ENOENT/ECONNREFUSED. Treat
      // that as "session just ended" (permanent 1008), not the generic "attach
      // failed" (1011), which would mislead the client into retrying a normal end.
      if (ws.readyState !== 1) return;
      const gone = e && (e.code === 'ENOENT' || e.code === 'ECONNREFUSED');
      gone ? ws.close(1008, 'session not found') : ws.close(1011, 'attach failed');
      return;
    }
    if (closed) { handle.detach(); return; }   // WS dropped while we were attaching

    const handleFrame = raw => {
      try {
        const msg = JSON.parse(raw.toString());
        // A `mode` frame flips this live connection between interactive/
        // spectator without reattaching: toggles the input/resize gate and
        // opens/closes the control socket (leaving/entering the resize clamp).
        // The data pipe is untouched, so the replay never re-runs on a focus change.
        if (msg.type === 'mode') {
          spectator = !!msg.spectator;
          handle.setSpectator?.(spectator);
          return;
        }
        // Spectator connections are watch-only: input/resize are dropped (not
        // errored) so a grid pane can't drive or resize the shared line; data
        // still flows outbound.
        if (spectator) return;
        if (msg.type === 'input') {
          handle.write(msg.payload);
          // Clears any needs-input flag the instant the operator answers here —
          // the precise "cleared on next input" signal (list()'s output-based
          // clear is only the fallback for input via another attach, e.g. `sb`).
          // Own guard+log after the write, so a missing method on a future
          // non-Board sessions store costs no keystroke and stays greppable.
          try { sessions.clearAttention(id); }
          catch (e) { console.error('[ws] clearAttention failed:', e && e.message ? e.message : e); }
        }
        if (msg.type === 'resize') handle.resize(msg.cols, msg.rows);
      } catch { /* malformed message — ignore */ }
    };

    // Drain in arrival order, then hand later frames straight through. The
    // buffered `resize` is what sizes the PTY to this client on a fresh attach.
    deliver = handleFrame;
    for (const raw of buffered) handleFrame(raw);
    buffered.length = 0;
  });
}

module.exports = { createWSHub };
