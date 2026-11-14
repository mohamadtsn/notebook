import { getItem, setItem } from '../utils/storage';
import type { NoteHistory } from '../utils/history';

const STORAGE_KEY = 'notebook_history';
type Store = Record<string, NoteHistory>;

export function dropHistory(noteId: string): void {
  const store = getItem<Store | null>(STORAGE_KEY, {}) ?? {};
  if (!Object.hasOwn(store, noteId)) return;
  delete store[noteId];
  setItem(STORAGE_KEY, store);
}

export function loadLegacyHistory(noteId: string): NoteHistory | null {
  return getItem<Store | null>(STORAGE_KEY, {})?.[noteId] ?? null;
}
