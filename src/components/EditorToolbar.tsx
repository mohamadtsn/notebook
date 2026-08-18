import { Download, MoreHorizontal, Pin, Trash2, Undo2 } from 'lucide-react';
import type { Note, NoteColor } from '../types/note';
import { NOTE_COLORS, NOTE_COLOR_LABEL, noteColorVar } from '../types/note';
import { IconButton } from './ui/IconButton';
import { Popover, PopoverItem } from './ui/Popover';
import { MoveToGroup } from './MoveToGroup';
import type { Group } from '../types/group';
import { SegmentedControl } from './ui/SegmentedControl';

export type EditorMode = 'write' | 'preview';

interface EditorToolbarProps {
  note: Note;
  groups: Group[];
  onMove: (groupId: string | null) => void;
  isTrash: boolean;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onTogglePin: (id: string) => void;
  onSetColor: (id: string, color: NoteColor | null) => void;
  onExport: (format: 'txt' | 'md') => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
}

const MODES: { value: EditorMode; label: string }[] = [
  { value: 'write', label: 'نوشتن' },
  { value: 'preview', label: 'نمایش' },
];

/**
 * DESIGN.md §6. Frequent actions sit inline; everything else is behind "…".
 * This is what used to live in the editor footer.
 */
export function EditorToolbar({
  note, groups, onMove, isTrash, mode, onModeChange,
  onTogglePin, onSetColor, onExport, onTrash, onRestore, onPermanentDelete,
}: EditorToolbarProps) {
  return (
    <div className="glass-panel flex items-center gap-1 rounded-full p-1">
      <SegmentedControl
        options={MODES}
        value={mode}
        onChange={onModeChange}
        label="حالت ویرایشگر"
      />

      {isTrash ? (
        <>
          <IconButton label="بازگرداندن" onClick={() => onRestore(note.id)}>
            <Undo2 size={16} />
          </IconButton>
          <IconButton label="حذف کامل" tone="danger" onClick={() => onPermanentDelete(note.id)}>
            <Trash2 size={16} />
          </IconButton>
        </>
      ) : (
        <>
          <IconButton
            label={note.pinned ? 'برداشتن سنجاق' : 'سنجاق کردن'}
            active={note.pinned}
            onClick={() => onTogglePin(note.id)}
          >
            <Pin size={16} />
          </IconButton>

          <Popover
            trigger={({ open, toggle }) => (
              <IconButton label="برچسب رنگی" active={open} onClick={toggle}>
                <span
                  className="block size-3.5 rounded-full border border-separator"
                  style={{ backgroundColor: note.color ? noteColorVar(note.color) : 'transparent' }}
                />
              </IconButton>
            )}
          >
            {({ close }) => (
              <div className="flex gap-1.5 p-1.5">
                {[...NOTE_COLORS, null].map(c => (
                  <button
                    key={c ?? 'none'}
                    onClick={() => { onSetColor(note.id, c); close(); }}
                    aria-label={c ? NOTE_COLOR_LABEL[c] : 'بدون برچسب'}
                    title={c ? NOTE_COLOR_LABEL[c] : 'بدون برچسب'}
                    // 24px dot, 44px hit area via the pad — DESIGN.md §8.
                    className="relative size-6 rounded-full border-2 transition-transform duration-[var(--d-press)] after:absolute after:inset-[-10px] after:content-[''] active:scale-90"
                    style={{
                      backgroundColor: c ? noteColorVar(c) : 'transparent',
                      borderColor: note.color === c ? 'var(--accent)' : 'var(--separator)',
                    }}
                  />
                ))}
              </div>
            )}
          </Popover>

          <Popover
            trigger={({ open, toggle }) => (
              <IconButton label="بیشتر" active={open} onClick={toggle}>
                <MoreHorizontal size={16} />
              </IconButton>
            )}
          >
            {({ close }) => (
              <>
                {!isTrash && (
                  <div className="mb-1 border-b border-separator pb-1">
                    <p className="px-3 py-1 text-[.6875rem] text-muted">انتقال به گروه</p>
                    <MoveToGroup
                      groups={groups}
                      currentGroupId={note.groupId}
                      onMove={g => { onMove(g); close(); }}
                    />
                  </div>
                )}
                <PopoverItem onClick={() => { onExport('md'); close(); }}>
                  <Download size={14} /> دانلود .md
                </PopoverItem>
                <PopoverItem onClick={() => { onExport('txt'); close(); }}>
                  <Download size={14} /> دانلود .txt
                </PopoverItem>
                <PopoverItem tone="danger" onClick={() => { onTrash(note.id); close(); }}>
                  <Trash2 size={14} /> حذف یادداشت
                </PopoverItem>
              </>
            )}
          </Popover>
        </>
      )}
    </div>
  );
}
