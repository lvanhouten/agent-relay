import React from 'react';
import { listSessions, createSession, killSession } from './api.ts';
import type { CreateSessionOpts } from './api.ts';
import { createPollSequence, filterKilled } from './sessionGuards.ts';
import type { Session } from './types.ts';
import type { Notifier } from './toastQueue.ts';

// The coalesce key for the sticky "relay unreachable" toast: every failed poll
// updates the one toast rather than stacking, and the next good poll clears it.
const RELAY_UNREACHABLE = 'relay-unreachable';

export interface Sessions {
  sessions: Session[];
  // Manual refresh. Safe from a consumer (pull-to-refresh, a focus handler):
  // reuses the same sequence guard and kill-suppression filter as the 5s poll,
  // so an out-of-band call can't stomp a newer poll's result.
  load: () => Promise<void>;
  // Resolves to the created session, or null if the call was dropped by the
  // re-entrancy guard (a second click while a create is in flight). Rejects on
  // server/network failure — the caller owns the error presentation.
  create: (opts: CreateSessionOpts) => Promise<Session | null>;
  kill: (id: string) => Promise<void>;
  creating: boolean;
}

// The sessions data layer: list + 5s poll + create/kill, with guards that
// fence React-specific pathologies (state commits lag events). The guards are
// refs precisely so they never retrigger effects — don't "clean them up" into state.
//
// No token parameter: the browser path is cookie-only post-boot (ar_auth
// rides every same-origin fetch by default).
//
// notifier is optional so the hook (and its guards) stay testable without a
// ToastProvider; when a shell passes one, otherwise-silent poll/kill failures
// surface as toasts. Must be a stable reference or the poll effect re-subscribes
// every render.
export function useSessions(notifier?: Notifier): Sessions {
  const [sessions, setSessions] = React.useState<Session[]>([]);

  // Poll guards (pure logic in sessionGuards.ts, held in refs): a sequence
  // guard against an older response stomping a newer one, and a set of
  // locally-killed ids so a just-killed session can't flicker back for a cycle.
  const pollSeq = React.useRef(createPollSequence());
  const killed = React.useRef(new Set<string>());

  const load = React.useCallback(async () => {
    const seq = pollSeq.current.begin();
    try {
      const list = await listSessions();
      if (!pollSeq.current.tryApply(seq)) return; // stale — a newer load() already applied
      setSessions(filterKilled(list, killed.current));
      // A poll that applied proves connectivity — clear any standing
      // relay-unreachable toast so the stale-list warning doesn't linger.
      notifier?.dismissKey(RELAY_UNREACHABLE);
    } catch {
      // Offline — keep the stale list, but stop the UI silently lying about it.
      // Sticky + coalesced: one warning, refreshed each failed poll, cleared on
      // the next good one above.
      notifier?.notify({
        key: RELAY_UNREACHABLE,
        severity: 'error',
        sticky: true,
        message: 'Relay unreachable. Retrying…',
      });
    }
  }, [notifier]);

  React.useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  // Synchronous re-entrancy guard: a `disabled`/`loading` prop only takes
  // effect after React commits state, so a fast double-click before that
  // re-render would otherwise fire two concurrent createSession calls.
  const [creating, setCreating] = React.useState(false);
  const creatingRef = React.useRef(false);
  const create = React.useCallback(async (opts: CreateSessionOpts) => {
    if (creatingRef.current) return null;
    creatingRef.current = true;
    setCreating(true);
    try {
      return await createSession(opts);
    } finally {
      setCreating(false);
      creatingRef.current = false;
    }
  }, []);

  // Per-id re-entrancy guard against a double-click firing two concurrent
  // killSession calls. A Set, not a single ref: killing two *different*
  // sessions concurrently is fine — only a repeat click on the same id blocks.
  const killingRef = React.useRef(new Set<string>());
  const kill = React.useCallback(async (id: string) => {
    if (killingRef.current.has(id)) return;
    killingRef.current.add(id);
    // Mark before the request so a poll resolving mid-kill (still listing this
    // id from a stale snapshot) is filtered — no flicker-back. Unmark once
    // confirmed gone, so a future reused id isn't permanently hidden.
    killed.current.add(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    try {
      await killSession(id);
    } catch {
      // Without this the operator has no idea the terminate didn't take — the
      // optimistic removal above flickers back on the reconcile poll regardless.
      notifier?.notify({
        severity: 'error',
        message: 'Could not end the session. It may still be running.',
      });
    } finally {
      // Reconcile against a fresh list, then stop suppressing the id.
      await load();
      killed.current.delete(id);
      killingRef.current.delete(id);
    }
  }, [load, notifier]);

  return { sessions, load, create, kill, creating };
}
