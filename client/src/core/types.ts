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
  // 'online' (live line) or 'exited' (a recently-ended tombstone from the
  // board's capped ring). The attention-states proposal widens this further;
  // keep it string until then.
  status: string;
  lastActive: string;
  // Present only on status 'exited' (sessions.js endedToDto): the process's
  // exit code (null if unknown) and whether it was killed via the board's
  // `end` command ('killed') or exited on its own ('exited').
  exitCode?: number | null;
  reason?: string;
}

export type ConnStatus = 'connecting' | 'reconnecting' | 'online' | 'offline';

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
