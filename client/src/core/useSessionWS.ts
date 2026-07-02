import React from 'react';
import { parseFrame, isValidDataPayload, isValidExitCode } from './wsFrame.ts';
import type { ConnStatus } from './types.ts';

export interface SessionWSHandlers {
  onData: (payload: string) => void;
  onExit: (code: number | null) => void;
  // reconnected -> caller resets the terminal before the scrollback replay
  onReady?: (reconnected: boolean) => void;
}

export interface SessionWS {
  connStatus: ConnStatus;
  send: (payload: string) => void;
  resize: (cols: number, rows: number) => void;
}

// WS lifecycle for one session: reconnect with exponential backoff, permanent
// stop on session exit / 1008, frame guards on every inbound message. Handlers
// must be stable references (the effect intentionally excludes them from its
// deps) — callers bridge through refs; see TerminalView.
export function useSessionWS(
  sessionId: string,
  token: string | undefined,
  { onData, onExit, onReady }: SessionWSHandlers,
): SessionWS {
  const [connStatus, setConnStatus] = React.useState<ConnStatus>('connecting');
  const wsRef = React.useRef<WebSocket | null>(null);

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
        onReady?.(reconnected);   // reconnected -> caller resets the terminal before the replay
      };

      ws.onmessage = (e) => {
        // A throw here (e.g. a malformed frame that isn't valid JSON) does NOT
        // close the socket or fire onerror/onclose — the connection would look
        // "online" but silently stop processing output, and the reconnect logic
        // would never engage. Swallow a bad frame instead of freezing the terminal.
        // parseFrame returns null for unparseable JSON AND for valid-but-non-object
        // frames (`null`, a bare number, a string) — a naive JSON.parse().type on
        // those would throw *outside* the parse try, reproducing the "online but
        // silently stops receiving" freeze this handler exists to prevent.
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
  // onData/onExit/onReady are stable refs — intentionally excluded from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, token]);

  const send = React.useCallback((payload: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'input', payload }));
  }, []);

  const resize = React.useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
  }, []);

  return { connStatus, send, resize };
}
