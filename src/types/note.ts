export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  color: NoteColor | null;
  pinned: boolean;
  deletedAt: number | null;
}

export type NoteColor = 'yellow' | 'blue' | 'green' | 'pink' | 'purple';

export const NOTE_COLOR_HEX: Record<NoteColor, string> = {
  yellow: '#F59E0B',
  blue:   '#3B82F6',
  green:  '#10B981',
  pink:   '#EC4899',
  purple: '#8B5CF6',
};