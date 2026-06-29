const BASE = '/api';

export async function listSessions() {
  const res = await fetch(`${BASE}/sessions`);
  if (!res.ok) throw new Error('failed to list sessions');
  return res.json();
}

export async function createSession({ name, cwd, shell, command }) {
  const res = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, cwd, shell, command }),
  });
  if (!res.ok) throw new Error('failed to create session');
  return res.json();
}

export async function killSession(id) {
  const res = await fetch(`${BASE}/sessions/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error('failed to kill session');
}
