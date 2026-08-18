import { useCallback, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { NoteColor } from '../types/note';
import type { Group, WireGroup } from '../types/group';
import { MAX_GROUP_NAME, migrateGroups, orderBetween } from '../types/group';
import { getItem, setItem } from '../utils/storage';
import { clearPushed, mergeById } from '../utils/merge';

const STORAGE_KEY = 'notebook_groups';

function persist(groups: Group[]): void {
  setItem(STORAGE_KEY, groups);
}

function patchGroup(groups: Group[], id: string, patch: Partial<Group>): Group[] {
  return groups.map(g => (g.id === id ? { ...g, ...patch, updatedAt: Date.now(), dirty: true } : g));
}

/** Same contract as useNotes: soft delete, synchronous persist inside the updater. */
export function useGroups() {
  const [groups, setGroups] = useState<Group[]>(() =>
    migrateGroups(getItem<Group[]>(STORAGE_KEY, [])),
  );

  const activeGroups = groups.filter(g => !g.deletedAt).sort((a, b) => a.order - b.order);

  const createGroup = useCallback((name: string): Group => {
    const trimmed = name.trim().slice(0, MAX_GROUP_NAME);
    const group: Group = {
      id: uuidv4(),
      name: trimmed,
      color: null,
      order: 0, // replaced below, once we can see the existing list
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
      dirty: true,
      syncedAt: null,
    };
    setGroups(prev => {
      const live = prev.filter(g => !g.deletedAt).sort((a, b) => a.order - b.order);
      group.order = orderBetween(live.length ? live[live.length - 1].order : null, null);
      const updated = [...prev, group];
      persist(updated);
      return updated;
    });
    return group;
  }, []);

  const renameGroup = useCallback((id: string, name: string) => {
    setGroups(prev => {
      const updated = patchGroup(prev, id, { name: name.trim().slice(0, MAX_GROUP_NAME) });
      persist(updated);
      return updated;
    });
  }, []);

  const setGroupColor = useCallback((id: string, color: NoteColor | null) => {
    setGroups(prev => {
      const updated = patchGroup(prev, id, { color });
      persist(updated);
      return updated;
    });
  }, []);

  /** Soft delete, exactly like a note — so the tombstone syncs and never resurrects. */
  const deleteGroup = useCallback((id: string) => {
    setGroups(prev => {
      const updated = patchGroup(prev, id, { deletedAt: Date.now() });
      persist(updated);
      return updated;
    });
  }, []);

  const restoreGroup = useCallback((id: string) => {
    setGroups(prev => {
      const updated = patchGroup(prev, id, { deletedAt: null });
      persist(updated);
      return updated;
    });
  }, []);

  const reorderGroup = useCallback((id: string, beforeId: string | null, afterId: string | null) => {
    setGroups(prev => {
      const find = (gid: string | null) => (gid ? (prev.find(g => g.id === gid)?.order ?? null) : null);
      const updated = patchGroup(prev, id, { order: orderBetween(find(beforeId), find(afterId)) });
      persist(updated);
      return updated;
    });
  }, []);

  /** The single write path for remote groups — same shape and reasoning as applySync. */
  const applyGroupSync = useCallback(
    (args: { remote: WireGroup[]; pushed: { id: string; updatedAt: number }[]; serverTime: number }) => {
      setGroups(prev => {
        const merged = mergeById<Group>(prev, args.remote, args.serverTime);
        const updated = clearPushed(merged, args.pushed, args.serverTime);
        persist(updated);
        return updated;
      });
    },
    [],
  );

  return {
    groups,
    activeGroups,
    createGroup,
    renameGroup,
    setGroupColor,
    deleteGroup,
    restoreGroup,
    reorderGroup,
    applyGroupSync,
  };
}
