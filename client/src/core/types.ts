// Contracts at the client-core seam: the session DTO the server emits, the WS
// frame vocabulary, and TerminalView's mode axis. Consumers outside core/
// (screens, future shells) import from here instead of re-deriving shapes
// from usage.

// Mirrors server/src/sessions.js toDto() — the one shape both GET /sessions and
// POST /sessions return.
export interface Session {
  id: string;
  name: string;
  shell: string;
  cwd: string;
  pid: number | null;
  // Attention state: 'running' (output within the idle threshold) or 'idle'
  // (quiet beyond it — thinking, blocked, or finished; PTY bytes can't tell).
  // 'needs-input' is a Claude Code Notification hook explicitly reporting a
  // blocked prompt (server sets via POST /api/notify, clears on next I/O).
  // 'turn-done' is a beaconed Claude line whose agent ended its turn, process
  // still alive. 'exited' is a tombstone from the board's capped ring. Kept
  // string (not a union) so an older/newer server can't type-error the
  // client; unknown values render as-is.
  status: string;
  lastActive: string;
  // Present only on status 'exited': the process's exit code (null if
  // unknown) and whether it was killed ('killed') or exited on its own
  // ('exited').
  exitCode?: number | null;
  reason?: string;
  // Live PTY grid: present on live lines, absent on a just-created session
  // until the first poll and on exited tombstones. A spectator TerminalView
  // adopts these dims and CSS-scales rather than resizing the shared line.
  cols?: number;
  rows?: number;
  // Live rendered-screen tail: last few plain-text rows of the line's
  // VT-emulated grid, a glance-level preview for fleet views, not a substitute
  // for attaching. Present only on live lines that have produced output.
  preview?: string[];
}

export type ConnStatus = 'connecting' | 'reconnecting' | 'online' | 'offline';

// Mirrors @xterm/addon-search's onDidChangeResults payload. resultCount is -1
// when the addon hasn't computed a count (e.g. an empty query); the find bar
// treats that as "no readout".
export interface SearchResults {
  resultIndex: number;
  resultCount: number;
}

// Server -> client frames (server/src/ws.js vocabulary).
export interface DataFrame { type: 'data'; payload: string }
export interface ExitFrame { type: 'exit'; code: number | null }
export type ServerFrame = DataFrame | ExitFrame;

// Client -> server frames.
export interface InputFrame { type: 'input'; payload: string }
export interface ResizeFrame { type: 'resize'; cols: number; rows: number }
export type ClientFrame = InputFrame | ResizeFrame;

// TerminalView's mode axis. 'interactive' fits the container and sends resize;
// 'spectator' adopts reported PTY dims and CSS-scales, sending no resize so it
// never clamps the shared line — the desktop grid's watch-only panes. Fixed
// per mount; a switch is a remount.
export type TerminalViewMode = 'interactive' | 'spectator';

// Mirrors GET /api/fs/browse's reply. `parent` is null at a filesystem root,
// so the picker hides the "up" affordance there. `entries` is directories only
// (isDir always true in v1). `truncated` means the dir held more than the server cap.
export interface BrowseEntry {
  name: string;
  isDir: boolean;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
  truncated: boolean;
}

// The typed filesystem conditions GET /api/fs/browse reports in a 4xx body
// instead of a 500 — the picker renders each in place and stays put.
export type BrowseErrorCode = 'denied' | 'not-found' | 'not-a-directory';

// Mirrors GET /api/pairing's response. pairingUrl is a full
// `https://<tunnel-host>/#token=<token>` string IFF tunnel.state==='up', null
// otherwise (a localhost URL would be unreachable from the paired device).
export type TunnelState = 'up' | 'down' | 'disabled';

export interface PairingInfo {
  tunnel: { state: TunnelState; reason: string | null };
  pairingUrl: string | null;
}
