'use strict';
const { WebSocketServer } = require('ws');
const { parse } = require('url');
const { StringDecoder } = require('string_decoder');
const { isAuthenticated, TOKEN, SIGNING_SECRET } = require('./auth');
const { originAllowed } = require('./origin');

// Initial spectator state for a connection: a query-param mode (`?mode=spectator`)
// set by the desktop grid's panes; scoped tokens will later derive it from the
// token scope, reusing this gate — one design, two consumers (ADR-0005). The
// grid then flips it live with a `mode` frame (below) so a focus change never
// reattaches. A spectator's inbound input/resize frames are dropped, not errored,
// and its control socket is closed so it leaves the board's resize clamp.
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

    // Origin gate first: CORS never applied to WebSockets, so without this any
    // page the operator's browser visits could open a socket to a line. Same
    // policy as the REST tier (src/origin.js); non-browser clients send no
    // Origin and pass through to the credential check.
    let spectator = initialSpectator(parsed.query);
    if (!originAllowed(req.headers.origin, req.headers.host)) { ws.close(1008, 'forbidden origin'); return; }
    // Either credential: the ?token= query param (non-browser clients, kept
    // byte-for-byte) or a valid auth cookie on the upgrade headers (browsers).
    // Same shared decision as the REST middleware so the two can't drift.
    if (!isAuthenticated({ token: parsed.query.token, cookieHeader: req.headers.cookie, expectedToken, signingSecret })) { ws.close(1008, 'unauthorized'); return; }
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
      // Log before closing 1011: unlike a board-unreachable close (a known,
      // expected condition), an unexpected lookup failure leaves an operator with
      // a closed socket and nothing to grep for. Mirror sessions.js's own pattern.
      console.error('[ws] session lookup failed:', e && e.message ? e.message : e);
      ws.close(1011, 'session lookup failed'); return;
    }
    if (!existing) { ws.close(1008, 'session not found'); return; }
    // A tombstone (recently-ended line) is listed but not attachable — its data
    // pipe is gone. Same permanent close code as "not found" so the client
    // doesn't retry a dead line.
    if (existing.status === 'exited') { ws.close(1008, 'session exited'); return; }

    // Attach to the board line. Scrollback replays down the data pipe on connect,
    // so there's no separate history step. Decode raw bytes -> string for the client.
    const decoder = new StringDecoder('utf8');
    let handle = null, closed = false;
    ws.on('close', () => { closed = true; if (handle) handle.detach(); });

    try {
      handle = await sessions.attach(id, {
        spectator,
        onData: buf => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'data', payload: decoder.write(buf) })); },
        onExit: code => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit', code })); },
      });
    } catch (e) {
      // The get()->attach() gap is an inherent TOCTOU: the line can end between
      // the existence check and the attach. When it does, the data pipe is gone
      // and connectPipe rejects with ENOENT/ECONNREFUSED — that's "the session
      // just ended" (permanent, code 1008), NOT the generic "attach failed"
      // (1011) the old catch reported, which misled the client into treating a
      // normal end as a retryable error.
      if (ws.readyState !== 1) return;
      const gone = e && (e.code === 'ENOENT' || e.code === 'ECONNREFUSED');
      gone ? ws.close(1008, 'session not found') : ws.close(1011, 'attach failed');
      return;
    }
    if (closed) { handle.detach(); return; }   // WS dropped while we were attaching

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString());
        // A `mode` frame flips this live connection between interactive and
        // spectator without reattaching: it toggles the input/resize gate and
        // opens/closes the control socket (leaving/entering the board's resize
        // clamp). The data pipe is untouched, so the reconstructed history replay
        // never re-runs on a focus change (ADR-0005 live mode-switch).
        if (msg.type === 'mode') {
          spectator = !!msg.spectator;
          handle.setSpectator?.(spectator);
          return;
        }
        // Spectator connections are watch-only: input/resize are dropped (not
        // errored) so a grid pane can't drive or resize the shared line
        // (ADR-0005). Data still flows outbound — watching is the whole point.
        if (spectator) return;
        if (msg.type === 'input') {
          handle.write(msg.payload);
          // The operator answered from the web terminal — clear any needs-input
          // flag immediately (the precise "cleared on next input" signal; the
          // output-based clear in sessions.list() is only the fallback for input
          // arriving via another attach, e.g. the `sb` pane). Own guard + log,
          // after the write: a sessions store missing this method (a rename, a
          // future non-Board implementation) must neither cost the keystroke
          // nor vanish into the malformed-message catch below — the failure
          // has to be greppable.
          try { sessions.clearAttention(id); }
          catch (e) { console.error('[ws] clearAttention failed:', e && e.message ? e.message : e); }
        }
        if (msg.type === 'resize') handle.resize(msg.cols, msg.rows);
      } catch { /* malformed message — ignore */ }
    });
  });
}

module.exports = { createWSHub };
