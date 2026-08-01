import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Note, NoteColor, WireNote } from '../types/note';
import { migrateNotes } from '../types/note';
import { getItem, setItem } from '../utils/storage';
import { clearPushed, mergeNotes } from '../utils/merge';

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

  const createNote = useCallback(() => {
    const note: Note = {
      id: uuidv4(),
      title: '',
      body: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      color: null,
      pinned: false,
      deletedAt: null,
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
    selectNote,
    applySync,
  };
}