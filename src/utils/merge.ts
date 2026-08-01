import type { Note, WireNote } from '../types/note';

/**
 * Last-write-wins by `updatedAt`, with one exception that matters more than the rule:
 * **a note with unpushed local edits is never replaced.** That covers the note being
 * typed into right now, and equally the one edited a minute ago and left behind by
 * switching notes — both hold text the server has not seen yet.
 *
 * Push runs before pull in the same cycle, so the remote copy of a still-dirty note is
 * usually the echo of our own push; skipping it costs nothing. If the push failed, the
 * local edit stays queued and wins by `updatedAt` on the next attempt.
 *
 * A tombstone is an ordinary update (`deletedAt` set, newer `updatedAt`), so deletes
 * propagate through the same comparison and never resurrect.
 */
export function mergeNotes(local: Note[], remote: WireNote[], syncedAt: number): Note[] {
  const byId = new Map(local.map(n => [n.id, n]));

  for (const r of remote) {
    const mine = byId.get(r.id);
    if (mine && mine.dirty) continue;
    if (mine && r.updatedAt <= mine.updatedAt) continue;
    byId.set(r.id, { ...r, dirty: false, syncedAt });
  }

  return [...byId.values()];
}

/**
 * Clears `dirty` on notes the server accepted — but only if the local note is still
 * byte-for-byte the version that was pushed. Anything edited while the request was in
 * flight keeps its flag and goes out with the next sync.
 */
export function clearPushed(
  notes: Note[],
  pushed: { id: string; updatedAt: number }[],
  syncedAt: number,
): Note[] {
  if (pushed.length === 0) return notes;
  const sent = new Map(pushed.map(p => [p.id, p.updatedAt]));
  return notes.map(n =>
    sent.get(n.id) === n.updatedAt ? { ...n, dirty: false, syncedAt } : n
  );
}