import { useCallback, useEffect } from 'react';
import { getItem, setItem } from '../utils/storage';
import {
  emptyHistory, evictHistories, record, redo, undo,
  type HistoryEntry, type NoteHistory,
} from '../utils/history';

const STORAGE_KEY = 'notebook_history';
/** Writes are batched: persisting a JSON store on every keystroke is pure waste. */
const FLUSH_MS = 1000;

type Store = Record<string, NoteHistory>;

/**
 * Loaded once per tab and kept at module scope, not in state: the editor remounts on
 * every note switch (`key={id}` in App), and history that dies with the component is
 * exactly the bug this replaces. Nothing here re-renders, so state would be wrong anyway.
 */
let store: Store | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function load(): Store {
  store ??= getItem<Store>(STORAGE_KEY, {});
  return store;
}

function flush() {
  flushTimer = null;
  if (store) setItem(STORAGE_KEY, evictHistories(store));
}

function schedule() {
  if (flushTimer === null) flushTimer = setTimeout(flush, FLUSH_MS);
}

/** Called when a note is destroyed for good — its history has nothing left to describe. */
export function dropHistory(noteId: string): void {
  delete load()[noteId];
  schedule();
}

export function useHistory(noteId: string, initial: string) {
  // Seed on first sight of a note. Without a first entry there is nothing to undo *to*.
  useEffect(() => {
    const s = load();
    s[noteId] ??= emptyHistory({ value: initial, start: initial.length, end: initial.length }, Date.now());
    // Persist whatever is pending if the tab goes away mid-edit.
    const onHide = () => { if (flushTimer !== null) { clearTimeout(flushTimer); flush(); } };
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); onHide(); };
    // Only on note change: `initial` moves with every keystroke and must not reseed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  /**
   * Call this for real edits only — typing and menu actions. An undo must NOT be pushed
   * back in, and it never is: writing `body` programmatically does not fire the
   * textarea's `change`, so this is only ever reached from an actual user edit.
   */
  const push = useCallback((entry: HistoryEntry, discrete = false) => {
    const s = load();
    const current = s[noteId] ?? emptyHistory(entry, Date.now());
    s[noteId] = record(current, entry, Date.now(), discrete);
    schedule();
  }, [noteId]);

  const step = useCallback((dir: 'undo' | 'redo'): HistoryEntry | null => {
    const s = load();
    const current = s[noteId];
    if (!current) return null;
    const next = (dir === 'undo' ? undo : redo)(current);
    if (!next) return null;
    s[noteId] = next.history;
    schedule();
    return next.entry;
  }, [noteId]);

  return { push, step };
}
