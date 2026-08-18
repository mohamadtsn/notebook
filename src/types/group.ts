import type { NoteColor } from './note';

export interface Group {
  id: string;
  name: string;
  color: NoteColor | null;
  /**
   * Sparse float, not a dense index. Inserting between two groups takes their
   * midpoint, so a reorder writes one row instead of renumbering every row and
   * marking the whole list dirty for the next push.
   */
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  /** Local-only sync bookkeeping. Stripped before a group goes to the server. */
  dirty: boolean;
  syncedAt: number | null;
}

export type WireGroup = Omit<Group, 'dirty' | 'syncedAt'>;

/** Listed, not spread — the server rejects unknown properties. Same rule as `toWire`. */
export function toWireGroup(g: Group): WireGroup {
  return {
    id: g.id,
    name: g.name,
    color: g.color,
    order: g.order,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    deletedAt: g.deletedAt,
  };
}

export function migrateGroups(groups: Group[]): Group[] {
  return groups.map(g => ({
    ...g,
    color: g.color ?? null,
    order: typeof g.order === 'number' ? g.order : 1,
    deletedAt: g.deletedAt ?? null,
    dirty: g.dirty ?? true,
    syncedAt: g.syncedAt ?? null,
  }));
}

/** Midpoint between two neighbours; ±1 at the ends; 1 for an empty list. */
export function orderBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1;
  if (before === null) return after! - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}

export const MAX_GROUP_NAME = 60;

/**
 * What the sidebar is filtered by. `'all'` = no filter, `null` = the «بدون گروه»
 * bucket, otherwise a group id. Lives here rather than in the component because
 * `App` owns the selection and needs the type before the strip is rendered.
 */
export type GroupFilter = 'all' | null | string;
