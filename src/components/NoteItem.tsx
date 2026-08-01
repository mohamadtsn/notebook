import { Pin } from 'lucide-react';
import type { Note } from '../types/note';
import { noteColorVar } from '../types/note';
import { cx } from './ui/cx';

interface NoteItemProps {
  note: Note;
  isActive: boolean;
  onClick: () => void;
}

function formatTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'همین الان';
  if (minutes < 60) return `${minutes} دقیقه پیش`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours} ساعت پیش`;
  const days = Math.floor(diff / 86400000);
  if (days < 7) return `${days} روز پیش`;
  return new Date(ms).toLocaleDateString('fa-IR');
}

export function NoteItem({ note, isActive, onClick }: NoteItemProps) {
  const title = note.title.trim() || 'یادداشت بدون عنوان';
  const preview = note.body.trim();

  // Label is a 3px inline-start bar, never a background fill — DESIGN.md §1
  const labelColor = note.color ? noteColorVar(note.color) : null;
  const barColor = isActive ? 'var(--accent)' : labelColor;

  return (
    <button
      onClick={onClick}
      aria-current={isActive ? 'true' : undefined}
      className={cx(
        'w-full border-b border-separator px-4 py-3 text-start',
        'transition-colors duration-(--d-fast)',
        isActive ? 'bg-accent-soft' : 'hover:bg-accent-soft/60',
      )}
      style={barColor ? { borderInlineStartColor: barColor, borderInlineStartWidth: 3 } : undefined}
    >
      <div className="flex items-center gap-1.5">
        {note.pinned && <Pin size={11} className="shrink-0 text-muted" />}
        {labelColor && (
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: labelColor }} />
        )}
        <p className={cx('truncate text-[.9375rem] font-medium', isActive ? 'text-ink' : 'text-ink-soft')}>
          {title}
        </p>
      </div>

      {preview && (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{preview}</p>
      )}
      <p className="mt-1.5 text-xs text-muted">{formatTime(note.updatedAt)}</p>
    </button>
  );
}
