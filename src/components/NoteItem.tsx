import { motion } from 'motion/react';
import { Pin } from 'lucide-react';
import { springDrag } from '../lib/motion';
import type { Note } from '../types/note';
import { noteColorVar } from '../types/note';
import { cx } from './ui/cx';

interface NoteItemProps {
  note: Note;
  isActive: boolean;
  onClick: () => void;
  /** Desktop only — see Sidebar. On touch this fights the sheet's drag-to-dismiss. */
  draggable?: boolean;
  onDragToGroup?: (groupId: string | null) => void;
  onDragHover?: (groupId: string | null) => void;
  /** Pointer coordinates. Shift+right-click is already filtered out by the row. */
  onContextMenu?: (x: number, y: number) => void;
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

export function NoteItem({
  note, isActive, onClick, draggable = false, onDragToGroup, onDragHover, onContextMenu,
}: NoteItemProps) {
  const title = note.title.trim() || 'یادداشت بدون عنوان';
  const preview = note.body.trim();

  // Label is a 3px inline-start bar, never a background fill — DESIGN.md §1
  const labelColor = note.color ? noteColorVar(note.color) : null;
  const barColor = isActive ? 'var(--accent)' : labelColor;

  // The strip's rows carry data-group-id; «بدون گروه» carries the sentinel.
  const groupUnderPointer = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-group-id]');
    return el?.dataset.groupId ?? null;
  };

  return (
    <motion.div
      drag={draggable}
      dragSnapToOrigin
      dragMomentum={false}
      // Release outside a target springs home — DESIGN.md §6 drop affordance.
      dragTransition={{ bounceStiffness: 400, bounceDamping: 40 }}
      transition={springDrag}
      onDrag={(_, info) => onDragHover?.(groupUnderPointer(info.point.x, info.point.y))}
      onDragEnd={(_, info) => {
        const target = groupUnderPointer(info.point.x, info.point.y);
        onDragHover?.(null);
        if (target !== null) onDragToGroup?.(target === '__none__' ? null : target);
      }}
      // Shift passes through to the browser's own menu, same rule as the editor.
      onContextMenu={e => {
        if (!onContextMenu || e.shiftKey) return;
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      className="relative"
    >
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
    </motion.div>
  );
}
