import type { Note, WireNote } from '../types/note';

/** Anything the sync loop can carry: an id, a clock, and local dirty bookkeeping. */
export interface Syncable {
  id: string;
  updatedAt: number;
  dirty: boolean;
  syncedAt: number | null;
}

/**
 * Last-write-wins by `updatedAt`, with one exception that matters more than the rule:
 * **a record with unpushed local edits is never replaced.** That covers the note being
 * typed into right now, and equally the one edited a minute ago and left behind by
 * switching notes — both hold text the server has not seen yet.
 *
 * Push runs before pull in the same cycle, so the remote copy of a still-dirty record is
 * usually the echo of our own push; skipping it costs nothing. If the push failed, the
 * local edit stays queued and wins by `updatedAt` on the next attempt.
 *
 * A tombstone is an ordinary update (`deletedAt` set, newer `updatedAt`), so deletes
 * propagate through the same comparison and never resurrect.
 *
 * Generic over the record type so notes and groups share one implementation — this rule
 * is the risk surface of the whole sync design and must not exist twice.
 */
export function mergeById<T extends Syncable>(
  local: T[],
  remote: Omit<T, 'dirty' | 'syncedAt'>[],
  syncedAt: number,
): T[] {
  const byId = new Map(local.map(n => [n.id, n]));

  for (const r of remote) {
    const mine = byId.get(r.id);
    if (mine && mine.dirty) continue;
    if (mine && r.updatedAt <= mine.updatedAt) continue;
    byId.set(r.id, { ...r, dirty: false, syncedAt } as T);
  }

  return [...byId.values()];
}

/** Notes are the original caller; the alias keeps every existing call site untouched. */
export function mergeNotes(local: Note[], remote: WireNote[], syncedAt: number): Note[] {
  return mergeById<Note>(local, remote, syncedAt);
}

/**
 * Clears `dirty` on records the server accepted — but only if the local copy is still
 * byte-for-byte the version that was pushed. Anything edited while the request was in
 * flight keeps its flag and goes out with the next sync.
 */
export function clearPushed<T extends Syncable>(
  items: T[],
  pushed: { id: string; updatedAt: number }[],
  syncedAt: number,
): T[] {
  if (pushed.length === 0) return items;
  const sent = new Map(pushed.map(p => [p.id, p.updatedAt]));
  return items.map(n => (sent.get(n.id) === n.updatedAt ? { ...n, dirty: false, syncedAt } : n));
}
