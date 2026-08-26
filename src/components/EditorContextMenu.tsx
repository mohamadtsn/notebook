import { ClipboardPaste, Copy, Languages, Scissors, Sparkles } from 'lucide-react';
import type { Group } from '../types/group';
import type { AiTask } from '../utils/aiCache';
import { isCoarsePointer } from '../utils/device';
import { ContextMenu } from './ui/ContextMenu';
import { PopoverItem } from './ui/Popover';
import { MoveToGroup } from './MoveToGroup';

/**
 * Clipboard read is permission-gated and absent in some browsers. A paste row that
 * silently does nothing is worse than no paste row, so its presence is probed once.
 */
const canPaste = typeof navigator !== 'undefined'
  && typeof navigator.clipboard?.readText === 'function';

interface EditorContextMenuProps {
  x: number;
  y: number;
  /** Body text and selection as they were when the menu opened. */
  value: string;
  from: number;
  to: number;
  groups: Group[];
  currentGroupId: string | null;
  /** Replaces [from, to) with `text`, leaving the caret after it. */
  onReplace: (from: number, to: number, text: string) => void;
  onMove: (groupId: string | null) => void;
  onAi: (task: AiTask) => void;
  onClose: () => void;
  /** Passed through: only a keyboard-opened menu takes focus. See ContextMenu. */
  autoFocus?: boolean;
}

export function EditorContextMenu({
  x, y, value, from, to, groups, currentGroupId, onReplace, onMove, onAi, onClose, autoFocus,
}: EditorContextMenuProps) {
  const selected = value.slice(from, to);

  return (
    <ContextMenu x={x} y={y} onClose={onClose} autoFocus={autoFocus}>
      {/* Cut and copy appear only with a selection: rows that do nothing are worse
          than absent rows, and there is no greyed-out state in this menu. */}
      {(selected || canPaste) && (
        <div className="border-b border-separator pb-1">
          {selected && (
            <>
              <PopoverItem
                onClick={() => {
                  void navigator.clipboard?.writeText(selected);
                  onReplace(from, to, '');
                  onClose();
                }}
              >
                <Scissors size={14} /> برش
              </PopoverItem>
              <PopoverItem
                onClick={() => { void navigator.clipboard?.writeText(selected); onClose(); }}
              >
                <Copy size={14} /> کپی
              </PopoverItem>
            </>
          )}
          {canPaste && (
            <PopoverItem
              onClick={() => {
                void navigator.clipboard.readText().then(text => onReplace(from, to, text));
                onClose();
              }}
            >
              <ClipboardPaste size={14} /> چسباندن
            </PopoverItem>
          )}
        </div>
      )}

      {/* Only with a selection: these act ON the selection, and an action that cannot
          work should not be offered. DESIGN.md §6. */}
      {selected && (
        <div className="border-b border-separator py-1">
          <p className="px-3 py-1 text-[.6875rem] text-muted">هوش مصنوعی</p>
          <PopoverItem onClick={() => { onAi('improve'); onClose(); }}>
            <Sparkles size={14} /> بهبود به عنوان prompt
          </PopoverItem>
          <PopoverItem onClick={() => { onAi('translate'); onClose(); }}>
            <Languages size={14} /> ترجمه
          </PopoverItem>
        </div>
      )}

      <div className="py-1">
        <p className="px-3 py-1 text-[.6875rem] text-muted">انتقال به گروه</p>
        <MoveToGroup
          groups={groups}
          currentGroupId={currentGroupId}
          onMove={g => { onMove(g); onClose(); }}
        />
      </div>

      {/* Advice for a keyboard and a mouse. On a phone there is neither, and the
          platform's own callout is reached by long-pressing the text directly. */}
      {!isCoarsePointer() && (
        <p className="border-t border-separator px-3 pt-2 pb-1 text-[.6875rem] leading-relaxed text-muted">
          برای منوی مرورگر، Shift + کلیک راست
        </p>
      )}
    </ContextMenu>
  );
}
