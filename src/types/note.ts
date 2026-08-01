export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  color: NoteColor | null;
  pinned: boolean;
  deletedAt: number | null;
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
  };
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
    // Notes written before sync existed have never been pushed, so they start dirty.
    dirty: n.dirty ?? true,
    syncedAt: n.syncedAt ?? null,
  }));
}