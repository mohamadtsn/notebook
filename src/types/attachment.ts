/**
 * A file attached to a note. The bytes never live here — only on the server, fetched on
 * demand. There is no offline blob cache in v1 (see utils/attachments.ts), so an
 * attachment is metadata plus a download URL.
 *
 * `dirty`/`syncedAt` are here to satisfy the shared `Syncable` shape that `mergeById`
 * merges on. They are effectively always `false`/set: an attachment is created by an
 * upload and tombstoned by a delete, both of which are server round trips, so the client
 * never holds an unpushed attachment change. That is also why attachments ride the pull
 * only and are absent from the push schema.
 */
export interface Attachment {
  id: string;
  noteId: string;
  /** The original filename, shown to the user. NEVER used as a path — the blob is a uuid. */
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  /** What the pull cursor orders on. Moves only when the row is tombstoned. */
  updatedAt: number;
  deletedAt: number | null;
  dirty: boolean;
  syncedAt: number | null;
}

export type WireAttachment = Omit<Attachment, 'dirty' | 'syncedAt'>;

/**
 * Listed, not spread — the server's `additionalProperties: false` means one stray local
 * field rejects the whole push. Same rule as `toWire` in note.ts. Nothing pushes
 * attachments today; this exists so that stays true if something ever does.
 */
export function toWireAttachment(a: Attachment): WireAttachment {
  return {
    id: a.id,
    noteId: a.noteId,
    name: a.name,
    mime: a.mime,
    size: a.size,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    deletedAt: a.deletedAt,
  };
}

export function migrateAttachments(raw: Attachment[]): Attachment[] {
  return raw.map(a => ({
    ...a,
    deletedAt: a.deletedAt ?? null,
    updatedAt: typeof a.updatedAt === 'number' ? a.updatedAt : a.createdAt,
    dirty: a.dirty ?? false,
    syncedAt: a.syncedAt ?? null,
  }));
}

/** Persian-friendly size label. Byte counts are what the user is being held to. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} بایت`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} کیلوبایت`;
  return `${(n / (1024 * 1024)).toFixed(1)} مگابایت`;
}
