import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Note, NoteColor } from '../types/note';
import { getItem, setItem } from '../utils/storage';

const STORAGE_KEY = 'notebook_notes';

function persist(notes: Note[]): void {
  setItem(STORAGE_KEY, notes);
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>(() => getItem<Note[]>(STORAGE_KEY, []));
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
      const updated = prev.map(n =>
        n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n
      );
      persist(updated);
      return updated;
    });
  }, []);

  const trashNote = useCallback((id: string) => {
    setNotes(prev => {
      const updated = prev.map(n =>
        n.id === id ? { ...n, deletedAt: Date.now() } : n
      );
      persist(updated);
      return updated;
    });
    setActiveNoteId(prev => (prev === id ? null : prev));
  }, []);

  const restoreNote = useCallback((id: string) => {
    setNotes(prev => {
      const updated = prev.map(n =>
        n.id === id ? { ...n, deletedAt: null } : n
      );
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
      const updated = prev.map(n =>
        n.id === id ? { ...n, pinned: !n.pinned, updatedAt: Date.now() } : n
      );
      persist(updated);
      return updated;
    });
  }, []);

  const setColor = useCallback((id: string, color: NoteColor | null) => {
    setNotes(prev => {
      const updated = prev.map(n =>
        n.id === id ? { ...n, color, updatedAt: Date.now() } : n
      );
      persist(updated);
      return updated;
    });
  }, []);

  const selectNote = useCallback((id: string | null) => {
    setActiveNoteId(id);
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
  };
}