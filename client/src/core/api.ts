import type { Session } from './types.ts';

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
