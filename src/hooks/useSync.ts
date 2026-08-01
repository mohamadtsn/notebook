import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note, WireNote } from '../types/note';
import { toWire } from '../types/note';
import { ApiError, api } from '../utils/api';
import { getItem, setItem } from '../utils/storage';
import { LAST_PULL_KEY } from './useAuth';

export type SyncState = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

const INTERVAL_MS = 60_000;

interface SyncOptions {
  token: string | null;
  notes: Note[];
  applySync: (args: {
    remote: WireNote[];
    pushed: { id: string; updatedAt: number }[];
    serverTime: number;
  }) => void;
  onUnauthorized: () => void;
}

/**
 * Push dirty → pull since the last cursor → merge. Runs on focus, on `online`, every
 * 60s, and on demand — never on a keystroke. Failure is recorded and retried on the
 * next trigger; nothing here ever blocks a local write.
 */
export function useSync({ token, notes, applySync, onUnauthorized }: SyncOptions) {
  const [state, setState] = useState<SyncState>('idle');

  // The loop reads the latest values through refs so the timer and listeners can be
  // registered once instead of re-subscribing on every keystroke.
  const latest = useRef({ token, notes, applySync, onUnauthorized });
  useEffect(() => {
    latest.current = { token, notes, applySync, onUnauthorized };
  });
  const running = useRef(false);

  const sync = useCallback(async () => {
    const { token: t, notes: current, applySync: apply } = latest.current;
    if (!t || running.current) return;
    if (!navigator.onLine) {
      setState('offline');
      return;
    }

    running.current = true;
    setState('syncing');
    try {
      const dirty = current.filter(n => n.dirty);
      let pushed: { id: string; updatedAt: number }[] = [];
      if (dirty.length) {
        const res = await api.push(t, dirty.map(toWire));
        const rejected = new Set(res.rejected);
        pushed = dirty
          .filter(n => !rejected.has(n.id))
          .map(n => ({ id: n.id, updatedAt: n.updatedAt }));
      }

      const since = getItem<number>(LAST_PULL_KEY, 0);
      const { notes: remote, serverTime } = await api.pull(t, since);
      apply({ remote, pushed, serverTime });
      setItem(LAST_PULL_KEY, serverTime);
      setState('synced');
    } catch (err) {
      // An expired or revoked token is the one failure that retrying can't fix.
      if (err instanceof ApiError && err.status === 401) latest.current.onUnauthorized();
      setState(navigator.onLine ? 'error' : 'offline');
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    // Deferred by a tick rather than called inline: the first thing sync() does is set
    // state, and doing that synchronously inside an effect cascades a second render.
    const kick = setTimeout(() => void sync(), 0);
    const timer = setInterval(() => void sync(), INTERVAL_MS);
    const trigger = () => void sync();
    const goOffline = () => setState('offline');
    window.addEventListener('focus', trigger);
    window.addEventListener('online', trigger);
    window.addEventListener('offline', goOffline);
    return () => {
      clearTimeout(kick);
      clearInterval(timer);
      window.removeEventListener('focus', trigger);
      window.removeEventListener('online', trigger);
      window.removeEventListener('offline', goOffline);
    };
  }, [token, sync]);

  // Signed out there is nothing to report — derived, so a stale error from the previous
  // session can't linger in the navbar.
  return { state: token ? state : 'idle', sync };
}