import { Pin, PinOff, RotateCcw, Trash2 } from 'lucide-react';
import type { Note } from '../types/note';
import { ContextMenu } from './ui/ContextMenu';
import { PopoverItem } from './ui/Popover';

interface NoteContextMenuProps {
  x: number;
  y: number;
  note: Note;
  onTogglePin: (id: string) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
  onClose: () => void;
}

/**
 * Right-click on a row in the note list. DESIGN.md §6 "Context menu".
 * A trashed row gets the two actions that mean anything there — pinning and trashing
 * a note that is already in the trash do not.
 */
export function NoteContextMenu({
  x, y, note, onTogglePin, onTrash, onRestore, onPermanentDelete, onClose,
}: NoteContextMenuProps) {
  const run = (fn: () => void) => () => { fn(); onClose(); };

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {note.deletedAt ? (
        <>
          <PopoverItem onClick={run(() => onRestore(note.id))}>
            <RotateCcw size={14} /> بازگرداندن
          </PopoverItem>
          <PopoverItem tone="danger" onClick={run(() => onPermanentDelete(note.id))}>
            <Trash2 size={14} /> حذف کامل
          </PopoverItem>
        </>
      ) : (
        <>
          <PopoverItem onClick={run(() => onTogglePin(note.id))}>
            {note.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            {note.pinned ? 'برداشتن سنجاق' : 'سنجاق کردن'}
          </PopoverItem>
          <PopoverItem tone="danger" onClick={run(() => onTrash(note.id))}>
            <Trash2 size={14} /> حذف
          </PopoverItem>
        </>
      )}
    </ContextMenu>
  );
}
