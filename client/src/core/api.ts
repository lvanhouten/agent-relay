import type { BrowseResult, BrowseErrorCode, PairingInfo, Session } from './types.ts';

const BASE = '/api';

export interface CreateSessionOpts {
  name?: string;
  cwd?: string;
  shell?: string;
  command?: string; // optional; runs in the shell, which stays open
}

// Single source of truth for request headers (incl. the Bearer scheme). Exported
// so other call sites — e.g. LoginScreen's connection probe — don't re-implement
// the auth-header construction and silently drift if the scheme ever changes.
export function headers(token?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function listSessions(token?: string): Promise<Session[]> {
  const res = await fetch(`${BASE}/sessions`, { headers: headers(token) });
  if (!res.ok) throw new Error('failed to list sessions');
  return res.json();
}

export async function createSession(
  { name, cwd, shell, command }: CreateSessionOpts,
  token?: string,
): Promise<Session> {
  const res = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ name, cwd, shell, command }),
  });
  if (!res.ok) throw new Error('failed to create session');
  return res.json();
}

export async function killSession(id: string, token?: string): Promise<void> {
  const res = await fetch(`${BASE}/sessions/${id}`, {
    method: 'DELETE',
    headers: headers(token),
  });
  if (!res.ok && res.status !== 404) throw new Error('failed to kill session');
}

// Exchanges a bearer token for the ar_auth cookie (POST /api/login — no body,
// bearer required). 204 means the cookie was granted and the browser can drop
// the token from memory; anything else (401 on a rotated/stale token) means
// it wasn't. Never throws on a non-2xx response — the caller (boot flow /
// manual login) only cares about the boolean.
export async function login(token: string): Promise<boolean> {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: headers(token),
  });
  return res.status === 204;
}

// Thrown by browseDir for the typed filesystem conditions the endpoint reports
// (denied / not-found / not-a-directory) — carries the machine-readable `code`
// and the server-resolved `path` so the picker can show the message in place and
// stay at the folder it was on, rather than treating it like a network failure.
export class BrowseError extends Error {
  code: BrowseErrorCode | undefined;
  path: string | undefined;
  constructor(code: BrowseErrorCode | undefined, path: string | undefined) {
    super(code ?? 'browse failed');
    this.name = 'BrowseError';
    this.code = code;
    this.path = path;
  }
}

// Lists a directory on the BOARD's filesystem for the create dialog's picker
// (GET /api/fs/browse). Cookie-authed like every post-boot call. A blank `path`
// lets the server resolve to home. Throws BrowseError on the typed 4xx
// conditions; a truly unexpected failure throws a plain Error.
export async function browseDir(path?: string): Promise<BrowseResult> {
  const q = path ? `?path=${encodeURIComponent(path)}` : '';
  const res = await fetch(`${BASE}/fs/browse${q}`, { headers: headers() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body && typeof body.error === 'string') {
      throw new BrowseError(body.error as BrowseErrorCode, body.path);
    }
    throw new Error('failed to browse directory');
  }
  return body as BrowseResult;
}

// Fetches tunnel status + (when up) the pairing URL. Cookie-authed like every
// other call post-boot (see App.jsx) — no bearer header, since the caller (the
// pair-device dialog) only ever renders after the sessions screen is reachable.
// Throws on any non-ok response (network failure, 401) so the caller can show
// an inline dialog error instead of an unhandled rejection.
export async function getPairing(): Promise<PairingInfo> {
  const res = await fetch(`${BASE}/pairing`, { headers: headers() });
  if (!res.ok) throw new Error('failed to fetch pairing info');
  return res.json();
}
