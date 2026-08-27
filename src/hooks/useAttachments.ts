import { useCallback, useState } from 'react';
import type { Attachment, WireAttachment } from '../types/attachment';
import { migrateAttachments } from '../types/attachment';
import { getItem, setItem } from '../utils/storage';
import { mergeById } from '../utils/merge';

const STORAGE_KEY = 'notebook_attachments';

function persist(items: Attachment[]): void {
  setItem(STORAGE_KEY, items);
}

/**
 * Attachment metadata, mirrored locally so a note shows its files the instant it opens.
 * The bytes are never here — see utils/attachments.ts.
 *
 * There is no `dirty` write path and there is not meant to be one: an attachment is
 * created by an upload and removed by a delete, both of which are server round trips
 * that only return once the server has recorded them. `add` and `drop` therefore record
 * an outcome rather than queue an intent, which is why `mergeById` is enough here —
 * nothing local can ever be newer than the server.
 */
export function useAttachments() {
  const [attachments, setAttachments] = useState<Attachment[]>(() =>
    migrateAttachments(getItem<Attachment[]>(STORAGE_KEY, [])),
  );

  const forNote = useCallback(
    (noteId: string) => attachments
      .filter(a => a.noteId === noteId && !a.deletedAt)
      .sort((a, b) => a.createdAt - b.createdAt),
    [attachments],
  );

  /** Records an upload the server has already accepted. */
  const add = useCallback((wire: WireAttachment) => {
    setAttachments(prev => {
      const updated = [
        ...prev.filter(a => a.id !== wire.id),
        { ...wire, dirty: false, syncedAt: Date.now() },
      ];
      persist(updated);
      return updated;
    });
  }, []);

  /** Records a delete the server has already accepted. Tombstone, never a removal. */
  const drop = useCallback((id: string) => {
    setAttachments(prev => {
      const now = Date.now();
      const updated = prev.map(a =>
        (a.id === id ? { ...a, deletedAt: now, updatedAt: now } : a));
      persist(updated);
      return updated;
    });
  }, []);

  /** The single write path for remote attachments — same shape as applyGroupSync. */
  const applyAttachmentSync = useCallback((args: {
    remote: WireAttachment[];
    serverTime: number;
  }) => {
    setAttachments(prev => {
      const updated = mergeById<Attachment>(prev, args.remote, args.serverTime);
      persist(updated);
      return updated;
    });
  }, []);

  /**
   * Sign-out drops the mirror. It is derived data about files that live behind an
   * account, and the next account on a shared device must not see the previous one's
   * filenames. Notes stay — that asymmetry is the same one `signOut` already keeps.
   */
  const clearAttachments = useCallback(() => {
    setAttachments([]);
    persist([]);
  }, []);

  return { attachments, forNote, add, drop, applyAttachmentSync, clearAttachments };
}
