import React from 'react';
import { listSessions, createSession, killSession } from './api.ts';
import type { CreateSessionOpts } from './api.ts';
import { createPollSequence, filterKilled } from './sessionGuards.ts';
import type { Session } from './types.ts';

export interface Sessions {
  sessions: Session[];
  load: () => Promise<void>;
  // Resolves to the created session, or null if the call was dropped by the
  // re-entrancy guard (a second click while a create is in flight). Rejects on
  // server/network failure — the caller owns the error presentation.
  create: (opts: CreateSessionOpts) => Promise<Session | null>;
  kill: (id: string) => Promise<void>;
  creating: boolean;
}

// The sessions data layer: list + 5s poll + create/kill, with the guards that
// fence React-specific pathologies (state commits lag events). The guards are
// refs precisely so they never retrigger effects — do not "clean them up" into
// state (see _docs/issues/2026-07-02-extract-client-core.md).
export function useSessions(token?: string): Sessions {
  const [sessions, setSessions] = React.useState<Session[]>([]);

  // Poll guards (pure logic in sessionGuards.ts, held in refs): a sequence
  // guard so overlapping load()s can't let an older response stomp a newer one,
  // and a set of ids killed locally but possibly still present in an in-flight
  // poll's stale list, so a just-killed session can't flicker back for a poll
  // cycle.
  const pollSeq = React.useRef(createPollSequence());
  const killed = React.useRef(new Set<string>());

  const load = React.useCallback(async () => {
    const seq = pollSeq.current.begin();
    try {
      const list = await listSessions(token);
      if (!pollSeq.current.tryApply(seq)) return; // stale — a newer load() already applied
      setSessions(filterKilled(list, killed.current));
    } catch { /* offline — keep stale list */ }
  }, [token]);

  React.useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  // Synchronous re-entrancy guard: a caller's `disabled`/`loading` prop only
  // takes effect after React commits state, so a fast double-click before that
  // re-render would otherwise fire two concurrent createSession calls (W4). A
  // ref flips immediately, closing that window.
  const [creating, setCreating] = React.useState(false);
  const creatingRef = React.useRef(false);
  const create = React.useCallback(async (opts: CreateSessionOpts) => {
    if (creatingRef.current) return null;
    creatingRef.current = true;
    setCreating(true);
    try {
      return await createSession(opts, token);
    } finally {
      setCreating(false);
      creatingRef.current = false;
    }
  }, [token]);

  // Per-id re-entrancy guard (W2): a fast double-click on the same Terminate
  // button before React commits any state fires two concurrent killSession
  // calls otherwise. A Set (not a single ref) because killing two *different*
  // sessions concurrently is fine — only a repeat click on the same id blocks.
  const killingRef = React.useRef(new Set<string>());
  const kill = React.useCallback(async (id: string) => {
    if (killingRef.current.has(id)) return;
    killingRef.current.add(id);
    // Mark before the request so any poll response that resolves during the kill
    // (and still lists this id from a stale board snapshot) is filtered out — no
    // flicker-back. Remove the mark once we've confirmed it's gone from a fresh
    // list, so a future reused id isn't permanently hidden.
    killed.current.add(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    try {
      await killSession(id, token);
    } finally {
      // Reconcile against a fresh list, then stop suppressing the id.
      await load();
      killed.current.delete(id);
      killingRef.current.delete(id);
    }
  }, [token, load]);

  return { sessions, load, create, kill, creating };
}
