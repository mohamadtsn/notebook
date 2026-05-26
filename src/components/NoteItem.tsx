import { Pin } from 'lucide-react';
import type { Note } from '../types/note';
import { NOTE_COLOR_HEX } from '../types/note';

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
  const preview = note.body.trim().slice(0, 80);
  const colorHex = note.color ? NOTE_COLOR_HEX[note.color] : null;

  return (
    <button
      onClick={onClick}
      className={`w-full text-right px-4 py-3 border-b border-border transition-colors hover:bg-border/30 ${
        isActive ? 'bg-accent/10' : ''
      }`}
      style={isActive && colorHex ? { borderLeftColor: colorHex, borderLeftWidth: 3 } :
             isActive ? { borderLeftColor: 'var(--accent)', borderLeftWidth: 3 } :
             colorHex ? { borderLeftColor: colorHex, borderLeftWidth: 3 } : undefined}
    >
      <div className="flex items-center gap-1.5 justify-end">
        {note.pinned && <Pin size={11} className="text-muted shrink-0" />}
        {colorHex && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: colorHex }}
          />
        )}
        <p className="text-sm font-medium text-ink truncate">{title}</p>
      </div>
      {preview && (
        <p className="text-xs text-muted mt-0.5 truncate">{preview}</p>
      )}
      <p className="text-xs text-muted mt-1">{formatTime(note.updatedAt)}</p>
    </button>
  );
}