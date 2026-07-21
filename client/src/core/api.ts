import type { BrowseResult, BrowseErrorCode, PairingInfo, Session } from './types.ts';

const BASE = '/api';

export interface CreateSessionOpts {
  name?: string;
  cwd?: string;
  shell?: string;
  command?: string; // optional; runs in the shell, which stays open
}

// Single source of truth for request headers (incl. the Bearer scheme), so
// other call sites (e.g. LoginScreen's probe) can't drift on the auth scheme.
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

// Exchanges a bearer token for the ar_auth cookie (POST /api/login). Resolves
// true only on 204 (cookie granted); never throws — callers only need the bool.
export async function login(token: string): Promise<boolean> {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: headers(token),
  });
  return res.status === 204;
}

// Typed filesystem conditions from browseDir (denied/not-found/not-a-directory)
// carry `code` + the server-resolved `path` so the picker can show the message
// in place and stay put, instead of treating it as a network failure.
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

// Lists a directory on the BOARD's filesystem for the create dialog's picker.
// A blank `path` resolves to home. Throws BrowseError on a typed 4xx condition,
// a plain Error on anything else unexpected.
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

// Fetches tunnel status + (when up) the pairing URL. No bearer header — the
// pair-device dialog only renders once cookie auth is already established.
// Throws on any non-ok response so the caller shows an inline error, not an
// unhandled rejection.
export async function getPairing(): Promise<PairingInfo> {
  const res = await fetch(`${BASE}/pairing`, { headers: headers() });
  if (!res.ok) throw new Error('failed to fetch pairing info');
  return res.json();
}
