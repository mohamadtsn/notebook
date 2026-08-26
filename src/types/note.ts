export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  color: NoteColor | null;
  pinned: boolean;
  deletedAt: number | null;
  /** `null` is the real, always-present «بدون گروه» bucket — not an error state. */
  groupId: string | null;
  /**
   * Body direction. `auto` runs `detectDirection`; the other two pin it.
   *
   * Pinning is not a preference — it is the only fix available for a mixed-script note.
   * Chrome's bidi hit-testing in a `dir="rtl"` <textarea> resolves a drag across a
   * script boundary to the wrong offsets (measured; see the v4 plan, Phase 1), and that
   * is the browser's, not ours. `ltr` takes the note out of bidi layout entirely.
   */
  dir: NoteDir;
  /** Local-only sync bookkeeping. Stripped before a note goes to the server. */
  dirty: boolean;
  syncedAt: number | null;
}

/** The note shape the server speaks — local-only sync bookkeeping stripped. */
export type WireNote = Omit<Note, 'dirty' | 'syncedAt'>;

/**
 * Fields are listed rather than spread-and-deleted: the server rejects unknown
 * properties, so a new local-only field must not be able to leak into a push by
 * accident.
 */
export function toWire(n: Note): WireNote {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    color: n.color,
    pinned: n.pinned,
    deletedAt: n.deletedAt,
    groupId: n.groupId,
    dir: n.dir,
  };
}

/** `auto` = derive from the text; the others pin it. */
export type NoteDir = 'auto' | 'rtl' | 'ltr';

export const NOTE_DIRS: NoteDir[] = ['auto', 'rtl', 'ltr'];

export const NOTE_DIR_LABEL: Record<NoteDir, string> = {
  auto: 'جهت متن: خودکار',
  rtl:  'جهت متن: راست‌به‌چپ',
  ltr:  'جهت متن: چپ‌به‌راست',
};

/** Unknown values (an older build, a hand-edited store) fall back to `auto`. */
export function migrateDir(dir: unknown): NoteDir {
  return NOTE_DIRS.includes(dir as NoteDir) ? (dir as NoteDir) : 'auto';
}

export type NoteColor = 'sand' | 'sky' | 'sage' | 'rose' | 'lilac';

export const NOTE_COLORS: NoteColor[] = ['sand', 'sky', 'sage', 'rose', 'lilac'];

export const NOTE_COLOR_LABEL: Record<NoteColor, string> = {
  sand:  'شنی',
  sky:   'آبی',
  sage:  'مریم‌گلی',
  rose:  'گلی',
  lilac: 'یاسی',
};

/** Resolves to a CSS variable so the label follows the active theme. */
export function noteColorVar(color: NoteColor): string {
  return `var(--label-${color})`;
}

/** v1 note colors → v2 label names. Applied once on read; see PLAN-V2 Phase 1.3. */
const LEGACY_COLORS: Record<string, NoteColor> = {
  yellow: 'sand',
  blue:   'sky',
  green:  'sage',
  pink:   'rose',
  purple: 'lilac',
};

export function migrateColor(color: unknown): NoteColor | null {
  if (typeof color !== 'string') return null;
  if (NOTE_COLORS.includes(color as NoteColor)) return color as NoteColor;
  return LEGACY_COLORS[color] ?? null;
}

export function migrateNotes(notes: Note[]): Note[] {
  return notes.map(n => ({
    ...n,
    color: migrateColor(n.color),
    groupId: n.groupId ?? null,
    dir: migrateDir(n.dir),
    // Notes written before sync existed have never been pushed, so they start dirty.
    dirty: n.dirty ?? true,
    syncedAt: n.syncedAt ?? null,
  }));
}