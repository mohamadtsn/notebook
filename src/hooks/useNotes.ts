import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Note, NoteColor, WireNote } from '../types/note';
import { migrateNotes } from '../types/note';
import { getItem, setItem } from '../utils/storage';
import { clearPushed, mergeNotes } from '../utils/merge';
import { dropHistory } from './useHistory';
import { dropCmHistory } from '../utils/cmHistory';

const STORAGE_KEY = 'notebook_notes';

function persist(notes: Note[]): void {
  setItem(STORAGE_KEY, notes);
}

/** Every local edit is a sync candidate, so patching a note always stamps `dirty`. */
function patchNote(notes: Note[], id: string, patch: Partial<Note>): Note[] {
  return notes.map(n =>
    n.id === id ? { ...n, ...patch, updatedAt: Date.now(), dirty: true } : n
  );
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>(() => migrateNotes(getItem<Note[]>(STORAGE_KEY, [])));
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);

  const activeNote = notes.find(n => n.id === activeNoteId) ?? null;
  const activeNotes  = notes.filter(n => !n.deletedAt);
  const trashedNotes = notes.filter(n => !!n.deletedAt);

  const createNote = useCallback((groupId: string | null = null) => {
    const note: Note = {
      id: uuidv4(),
      title: '',
      body: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      color: null,
      pinned: false,
      deletedAt: null,
      groupId,
      dirty: true,
      syncedAt: null,
    };
    setNotes(prev => {
      const updated = [note, ...prev];
      persist(updated);
      return updated;
    });
    setActiveNoteId(note.id);
  }, []);

  const updateNote = useCallback((
    id: string,
    patch: Partial<Pick<Note, 'title' | 'body' | 'color' | 'pinned'>>,
  ) => {
    setNotes(prev => {
      const updated = patchNote(prev, id, patch);
      persist(updated);
      return updated;
    });
  }, []);

  const trashNote = useCallback((id: string) => {
    setNotes(prev => {
      const updated = patchNote(prev, id, { deletedAt: Date.now() });
      persist(updated);
      return updated;
    });
    setActiveNoteId(prev => (prev === id ? null : prev));
  }, []);

  const restoreNote = useCallback((id: string) => {
    setNotes(prev => {
      const updated = patchNote(prev, id, { deletedAt: null });
      persist(updated);
      return updated;
    });
  }, []);

  const permanentDelete = useCallback((id: string) => {
    // The note is gone for good, so its undo history has nothing left to describe.
    dropHistory(id);
    dropCmHistory(id);
    setNotes(prev => {
      const updated = prev.filter(n => n.id !== id);
      persist(updated);
      return updated;
    });
    setActiveNoteId(prev => (prev === id ? null : prev));
  }, []);

  const togglePin = useCallback((id: string) => {
    setNotes(prev => {
      const target = prev.find(n => n.id === id);
      const updated = patchNote(prev, id, { pinned: !target?.pinned });
      persist(updated);
      return updated;
    });
  }, []);

  const setColor = useCallback((id: string, color: NoteColor | null) => {
    setNotes(prev => {
      const updated = patchNote(prev, id, { color });
      persist(updated);
      return updated;
    });
  }, []);

  const setGroup = useCallback((id: string, groupId: string | null) => {
    setNotes(prev => {
      const updated = patchNote(prev, id, { groupId });
      persist(updated);
      return updated;
    });
  }, []);

  /**
   * Deleting a group never deletes its notes — they fall back to «بدون گروه».
   * Returns the previous assignments so the undo toast can put them back; capturing
   * them after the write would be too late. Reading the render-time `notes` array
   * instead would miss a write that landed in the same tick, which is why this
   * writes to a closure variable from inside the updater.
   */
  const clearGroup = useCallback((groupId: string): { id: string; groupId: string | null }[] => {
    let previous: { id: string; groupId: string | null }[] = [];
    setNotes(prev => {
      previous = prev.filter(n => n.groupId === groupId).map(n => ({ id: n.id, groupId }));
      const updated = prev.map(n =>
        n.groupId === groupId ? { ...n, groupId: null, updatedAt: Date.now(), dirty: true } : n
      );
      persist(updated);
      return updated;
    });
    return previous;
  }, []);

  const restoreGroups = useCallback((assignments: { id: string; groupId: string | null }[]) => {
    setNotes(prev => {
      const map = new Map(assignments.map(a => [a.id, a.groupId]));
      const updated = prev.map(n =>
        map.has(n.id) ? { ...n, groupId: map.get(n.id)!, updatedAt: Date.now(), dirty: true } : n
      );
      persist(updated);
      return updated;
    });
  }, []);

  const selectNote = useCallback((id: string | null) => {
    setActiveNoteId(id);
  }, []);

  /**
   * The single write path for the sync loop: merge what the server sent, then clear
   * `dirty` on what it accepted. One state update, so a pull can't land between the two.
   */
  const applySync = useCallback((args: {
    remote: WireNote[];
    pushed: { id: string; updatedAt: number }[];
    serverTime: number;
  }) => {
    setNotes(prev => {
      const merged = mergeNotes(prev, args.remote, args.serverTime);
      const updated = clearPushed(merged, args.pushed, args.serverTime);
      persist(updated);
      return updated;
    });
  }, []);

  return {
    notes,
    activeNote,
    activeNoteId,
    activeNotes,
    trashedNotes,
    createNote,
    updateNote,
    trashNote,
    restoreNote,
    permanentDelete,
    togglePin,
    setColor,
    setGroup,
    clearGroup,
    restoreGroups,
    selectNote,
    applySync,
  };
}