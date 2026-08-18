import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note, WireNote } from '../types/note';
import { toWire } from '../types/note';
import type { Settings, WireSettings } from '../types/settings';
import { toWireSettings } from '../types/settings';
import type { Group, WireGroup } from '../types/group';
import { toWireGroup } from '../types/group';
import { ApiError, api } from '../utils/api';
import { getItem, setItem } from '../utils/storage';
import { LAST_PULL_KEY } from './useAuth';

export type SyncState = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

interface SyncOptions {
  token: string | null;
  notes: Note[];
  /** null = no timer. Focus/online/manual triggers still run — see the effect below. */
  intervalMs: number | null;
  settings: Settings;
  applyRemoteSettings: (remote: WireSettings) => void;
  groups: Group[];
  applyGroupSync: (args: {
    remote: WireGroup[];
    pushed: { id: string; updatedAt: number }[];
    serverTime: number;
  }) => void;
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
export function useSync({
  token, notes, intervalMs, settings, applyRemoteSettings, groups, applyGroupSync,
  applySync, onUnauthorized,
}: SyncOptions) {
  const [state, setState] = useState<SyncState>('idle');
  const [settingsState, setSettingsState] = useState<SyncState>('idle');

  // The loop reads the latest values through refs so the timer and listeners can be
  // registered once instead of re-subscribing on every keystroke. `settings` belongs
  // here for the same reason: it changes on every preference edit.
  const latest = useRef({
    token, notes, settings, applyRemoteSettings, groups, applyGroupSync, applySync, onUnauthorized,
  });
  useEffect(() => {
    latest.current = {
      token, notes, settings, applyRemoteSettings, groups, applyGroupSync, applySync, onUnauthorized,
    };
  });
  const running = useRef(false);

  const sync = useCallback(async () => {
    const {
      token: t, notes: current, groups: currentGroups,
      applySync: apply, applyGroupSync: applyGroups,
    } = latest.current;
    if (!t || running.current) return;
    if (!navigator.onLine) {
      setState('offline');
      return;
    }

    running.current = true;
    setState('syncing');
    try {
      const dirty = current.filter(n => n.dirty);
      const dirtyGroups = currentGroups.filter(g => g.dirty);
      let pushed: { id: string; updatedAt: number }[] = [];
      let pushedGroups: { id: string; updatedAt: number }[] = [];
      if (dirty.length || dirtyGroups.length) {
        const res = await api.push(t, dirty.map(toWire), dirtyGroups.map(toWireGroup));
        const rejected = new Set(res.rejected);
        const rejectedGroups = new Set(res.rejectedGroups ?? []);
        pushed = dirty
          .filter(n => !rejected.has(n.id))
          .map(n => ({ id: n.id, updatedAt: n.updatedAt }));
        pushedGroups = dirtyGroups
          .filter(g => !rejectedGroups.has(g.id))
          .map(g => ({ id: g.id, updatedAt: g.updatedAt }));
      }

      const since = getItem<number>(LAST_PULL_KEY, 0);
      const { notes: remote, groups: remoteGroups, serverTime } = await api.pull(t, since);
      // Groups first: the note merge that follows may reference a group that only just
      // arrived, and a note pointing at a group the UI has not seen yet renders as
      // «بدون گروه» for one frame.
      applyGroups({ remote: remoteGroups ?? [], pushed: pushedGroups, serverTime });
      apply({ remote, pushed, serverTime });
      setItem(LAST_PULL_KEY, serverTime);

      // Settings ride the same cycle but report separately: notes are the user's data,
      // settings are a preference. A failed preferences round trip must never make the
      // note sync look broken.
      const { settings: s, applyRemoteSettings: applySettings } = latest.current;
      try {
        setSettingsState('syncing');
        if (s.dirty) {
          // Dirty: push and adopt whatever comes back — either our own write, or the
          // newer copy that beat us. A clean local copy never needs to push.
          const won = await api.putSettings(t, toWireSettings(s), s.updatedAt);
          applySettings(won.settings);
        } else {
          const remote = await api.getSettings(t);
          if (remote.settings) applySettings(remote.settings);
        }
        setSettingsState('synced');
      } catch {
        setSettingsState('error');
      }

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
    // `intervalMs === null` means the user turned the *timer* off, not sync. The focus,
    // online, and manual triggers stay registered in every case — they cost nothing and
    // they are what makes sync feel instant. Dropping them would turn "off" into "broken".
    const timer = intervalMs === null ? null : setInterval(() => void sync(), intervalMs);
    const trigger = () => void sync();
    const goOffline = () => setState('offline');
    window.addEventListener('focus', trigger);
    window.addEventListener('online', trigger);
    window.addEventListener('offline', goOffline);
    return () => {
      clearTimeout(kick);
      if (timer !== null) clearInterval(timer);
      window.removeEventListener('focus', trigger);
      window.removeEventListener('online', trigger);
      window.removeEventListener('offline', goOffline);
    };
  }, [token, sync, intervalMs]);

  // Signed out there is nothing to report — derived, so a stale error from the previous
  // session can't linger in the navbar.
  return {
    state: token ? state : 'idle',
    settingsState: token ? settingsState : 'idle',
    sync,
  };
}