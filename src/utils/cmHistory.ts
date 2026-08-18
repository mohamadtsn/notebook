import { getItem, setItem } from './storage.ts';

const STORAGE_KEY = 'notebook_cm_history';
/**
 * Smaller than the textarea history's 512KB budget: a CodeMirror history snapshot carries
 * the document *and* every change since, so a few notes go further than a hundred plain
 * entries. It shares one localStorage budget with the notes themselves (§Storage), and the
 * notes are the product promise.
 */
const MAX_BYTES = 256 * 1024;

/** `EditorState.toJSON({ history: historyField })` output — opaque here on purpose. */
export interface CmSnapshot {
  doc: string;
  [field: string]: unknown;
}

interface Entry {
  snapshot: CmSnapshot;
  updatedAt: number;
}

type Store = Record<string, Entry>;

/**
 * Module scope, exactly like `useHistory`'s store and for the same reason: the editor
 * remounts on every note switch (`key={id}` in App), so anything held in component state
 * dies precisely when the user switches away and back.
 */
let store: Store | null = null;

function load(): Store {
  store ??= getItem<Store>(STORAGE_KEY, {});
  return store;
}

/**
 * Whole notes are evicted, least-recently-touched first — never a truncated snapshot.
 * Half a history is not a history: `EditorState.fromJSON` would either throw or restore
 * an undo stack that no longer matches its own document.
 */
export function evictCmHistories(s: Store): Store {
  const out = { ...s };
  let ids = Object.keys(out).sort((a, b) => out[a].updatedAt - out[b].updatedAt);
  while (ids.length > 1 && JSON.stringify(out).length > MAX_BYTES) {
    delete out[ids[0]];
    ids = ids.slice(1);
  }
  return out;
}

export function loadCmHistory(noteId: string): CmSnapshot | null {
  return load()[noteId]?.snapshot ?? null;
}

export function saveCmHistory(noteId: string, snapshot: CmSnapshot): void {
  const s = load();
  s[noteId] = { snapshot, updatedAt: Date.now() };
  store = evictCmHistories(s);
  setItem(STORAGE_KEY, store);
}

/** The note is gone for good; its undo stack has nothing left to describe. */
export function dropCmHistory(noteId: string): void {
  const s = load();
  if (!(noteId in s)) return;
  delete s[noteId];
  setItem(STORAGE_KEY, s);
}

export function clearCmHistory(): void {
  store = {};
  setItem(STORAGE_KEY, store);
}
