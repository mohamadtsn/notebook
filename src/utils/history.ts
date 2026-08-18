/**
 * Per-note edit history. The browser's own undo stack dies with the element and with
 * the tab; this one is keyed by note id and persisted, so undo survives switching
 * notes, toggling the preview, and a reload.
 *
 * Pure functions here, storage in `useHistory` — the rules are the part worth testing.
 */

export interface HistoryEntry {
  value: string;
  start: number;
  end: number;
}

export interface NoteHistory {
  entries: HistoryEntry[];
  /** Index of the entry currently shown. Undo walks down, redo walks up. */
  index: number;
  updatedAt: number;
}

/** Per note. Deep history is worth little and costs a lot of storage. */
export const MAX_ENTRIES = 100;
/**
 * Whole-store ceiling. localStorage is one small budget shared with the notes
 * themselves, and history that costs the user their ability to save a note is a bad
 * trade. The oldest-touched notes lose their history first.
 */
export const MAX_BYTES = 512 * 1024;
/** Consecutive keystrokes inside this window collapse into one undo step. */
export const COALESCE_MS = 700;

export function emptyHistory(entry: HistoryEntry, now: number): NoteHistory {
  return { entries: [entry], index: 0, updatedAt: now };
}

/**
 * Records a new state. Four rules:
 *  - an unchanged value is not a step (selection moves are not edits);
 *  - a typing step recorded within COALESCE_MS of the previous one replaces it, so undo
 *    moves by words rather than by characters;
 *  - a `discrete` step never coalesces. Cut, paste and an AI replacement are single
 *    deliberate acts, and merging one into the words typed just before it means a single
 *    Ctrl+Z throws away both;
 *  - recording after an undo drops the redo tail, which is what every editor does.
 */
export function record(
  h: NoteHistory,
  entry: HistoryEntry,
  now: number,
  discrete = false,
): NoteHistory {
  const current = h.entries[h.index];
  if (current && current.value === entry.value) return h;

  const kept = h.entries.slice(0, h.index + 1);
  const coalesce = !discrete && now - h.updatedAt < COALESCE_MS && kept.length > 1;
  const entries = coalesce ? [...kept.slice(0, -1), entry] : [...kept, entry];

  // Trim from the old end; the newest states are the ones the user will reach for.
  const trimmed = entries.slice(Math.max(0, entries.length - MAX_ENTRIES));
  return { entries: trimmed, index: trimmed.length - 1, updatedAt: now };
}

export function undo(h: NoteHistory): { history: NoteHistory; entry: HistoryEntry } | null {
  if (h.index <= 0) return null;
  const index = h.index - 1;
  return { history: { ...h, index }, entry: h.entries[index] };
}

export function redo(h: NoteHistory): { history: NoteHistory; entry: HistoryEntry } | null {
  if (h.index >= h.entries.length - 1) return null;
  const index = h.index + 1;
  return { history: { ...h, index }, entry: h.entries[index] };
}

/**
 * Drops whole notes' histories, least-recently-touched first, until the store fits.
 * Never partial: half a history is worse than none, because undo would silently stop
 * somewhere the user did not expect.
 */
export function evictHistories(store: Record<string, NoteHistory>): Record<string, NoteHistory> {
  const size = (h: NoteHistory) => h.entries.reduce((n, e) => n + e.value.length, 0);
  const byRecency = Object.entries(store).sort((a, b) => b[1].updatedAt - a[1].updatedAt);

  const kept: Record<string, NoteHistory> = {};
  let bytes = 0;
  for (const [id, h] of byRecency) {
    const cost = size(h);
    if (bytes + cost > MAX_BYTES) break;
    bytes += cost;
    kept[id] = h;
  }
  return kept;
}
