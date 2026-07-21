import React from 'react';
import { parseFrame, isValidDataPayload, isValidExitCode } from './wsFrame.ts';
import type { ConnStatus, TerminalViewMode } from './types.ts';

export interface SessionWSHandlers {
  onData: (payload: string) => void;
  onExit: (code: number | null) => void;
  // reconnected -> caller resets the terminal before the scrollback replay
  onReady?: (reconnected: boolean) => void;
}

export interface SessionWS {
  connStatus: ConnStatus;
  // Returns true when the frame was handed to an OPEN socket. False means the
  // payload was dropped (connecting/reconnecting/closed) — there is no queue,
  // so the caller must keep the user's text instead of pretending it was sent.
  send: (payload: string) => boolean;
  resize: (cols: number, rows: number) => void;
}

// WS lifecycle for one session: exponential-backoff reconnect, permanent stop
// on exit/1008, frame guards on every inbound message. Handlers must be stable
// refs (excluded from the effect's deps) — callers bridge through refs.
export function useSessionWS(
  sessionId: string,
  token: string | undefined,
  { onData, onExit, onReady }: SessionWSHandlers,
  // Interactive vs spectator, pushed as a live `mode` frame, NOT a URL param:
  // a grid focus change must NOT reconnect (would re-run the history replay
  // and corrupt a long session), so mode is excluded from the connect effect's
  // deps. Server toggles input-gating in place; onopen re-sends current mode.
  mode: TerminalViewMode = 'interactive',
): SessionWS {
  // Optional: the browser path is cookie-only post-boot (ar_auth rides the
  // upgrade), so callers pass undefined and qs stays empty. Non-browser WS
  // callers may still use ?token= server-side — not this hook's concern.
  const [connStatus, setConnStatus] = React.useState<ConnStatus>('connecting');
  const wsRef = React.useRef<WebSocket | null>(null);

  // Current desired mode, read at onopen and on every change. A ref (not a dep)
  // so flipping mode pushes a frame over the live socket instead of reconnecting.
  const modeRef = React.useRef(mode);
  const sendMode = React.useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'mode', spectator: modeRef.current === 'spectator' }));
  }, []);
  React.useEffect(() => { modeRef.current = mode; sendMode(); }, [mode, sendMode]);

  React.useEffect(() => {
    if (!sessionId) return;
    let stopped = false;   // component unmounted / deps changed — stop for good
    let ended = false;     // session exited or is gone — reconnecting is pointless
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (stopped) return;
      setConnStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      const ws = new WebSocket(`${proto}//${location.host}/sessions/${sessionId}${qs}`);
      wsRef.current = ws;

      ws.onopen = () => {
        const reconnected = attempt > 0;
        attempt = 0;
        setConnStatus('online');
        sendMode();               // restore this connection's mode on (re)connect
        onReady?.(reconnected);   // reconnected -> caller resets the terminal before the replay
      };

      ws.onmessage = (e) => {
        // A throw here (bad JSON) does NOT close the socket or fire onclose —
        // the connection would look 'online' but silently stop, and reconnect
        // would never engage. parseFrame returns null for unparseable JSON and
        // for valid-but-non-object frames, so a bad one is dropped, not thrown.
        const msg = parseFrame(e.data);
        if (!msg) return;
        if (msg.type === 'data' && isValidDataPayload(msg)) onData(msg.payload);
        // An exit frame always ends the session — gating that on the code's
        // validity would strand the client reconnecting to a dead line. Only
        // the code value itself is guarded: normalized to null if malformed.
        if (msg.type === 'exit') {
          ended = true;
          setConnStatus('offline');
          onExit(isValidExitCode(msg) ? msg.code : null);
        }
      };

      ws.onerror = () => { /* onclose drives recovery */ };

      ws.onclose = (ev) => {
        if (wsRef.current === ws) wsRef.current = null;
        if (stopped) return;
        // 1008 = unauthorized / session not found: permanent, don't retry.
        if (ended || ev.code === 1008) { setConnStatus('offline'); return; }
        setConnStatus('reconnecting');
        const delay = Math.min(500 * 2 ** attempt, 8000);   // 0.5s → 8s cap
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      const ws = wsRef.current;
      if (ws) { ws.onclose = null; ws.close(); wsRef.current = null; }
    };
  // onData/onExit/onReady are stable refs, and `mode` is pushed as a live frame
  // (see modeRef/sendMode) — all intentionally excluded so only session/token
  // changes reconnect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, token]);

  const send = React.useCallback((payload: string): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', payload }));
      return true;
    }
    return false;
  }, []);

  const resize = React.useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
  }, []);

  return { connStatus, send, resize };
}
