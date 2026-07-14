// Contracts at the client-core seam. These pin the shapes that used to be
// implicit in the screens: the session DTO the server emits, the WS frame
// vocabulary, and TerminalView's mode axis. Consumers outside core/ (screens,
// future shells) import from here instead of re-deriving shapes from usage.

// Mirrors server/src/sessions.js toDto() — the one shape both GET /sessions and
// POST /sessions return.
export interface Session {
  id: string;
  name: string;
  shell: string;
  cwd: string;
  pid: number | null;
  // Attention state. Live lines are 'running' (output within the board's
  // shared idle threshold) or 'idle' (quiet beyond it — which may mean
  // thinking, blocked on a prompt, or finished; PTY bytes can't tell), or
  // 'needs-input' when a Claude Code Notification hook has explicitly reported
  // the line as blocked on a prompt (server sets it via POST /api/notify,
  // clears it on next input/output). 'turn-done' is a beaconed Claude line
  // whose agent ended its turn — the process is still alive and waiting on
  // the user, distinct from 'exited' (see ADR-0003). 'exited' is a
  // recently-ended tombstone from the board's capped ring. Kept string (not a
  // union) so an older/newer server can't type-error the client; render
  // unknown values as-is.
  status: string;
  lastActive: string;
  // Present only on status 'exited' (sessions.js endedToDto): the process's
  // exit code (null if unknown) and whether it was killed via the board's
  // `end` command ('killed') or exited on its own ('exited').
  exitCode?: number | null;
  reason?: string;
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

// TerminalView's mode axis. Only 'interactive' (fit the container + send resize)
// is implemented; 'spectator' (adopt the reported PTY dims + CSS-scale, never
// send resize) is declared now so the desktop shell lands against a stated
// contract instead of retrofitting one — see
// _docs/issues/2026-07-02-desktop-workspace-shell.md.
export type TerminalViewMode = 'interactive' | 'spectator';

// Mirrors server/src/fsBrowse.js — the GET /api/fs/browse reply for the create
// dialog's directory picker. `parent` is null at a filesystem root (drive root /
// POSIX /), so the picker hides the "up" affordance there. `entries` is
// directories only (isDir always true in v1; kept explicit for a future files
// pass). `truncated` means the directory held more than the server cap.
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

// Mirrors server/src/pairing.js's GET /api/pairing response. pairingUrl is a
// full `https://<tunnel-host>/#token=<token>` string IFF tunnel.state==='up';
// null otherwise (down/disabled never expose a URL — a localhost URL would be
// unreachable from the device being paired).
export type TunnelState = 'up' | 'down' | 'disabled';

export interface PairingInfo {
  tunnel: { state: TunnelState; reason: string | null };
  pairingUrl: string | null;
}
