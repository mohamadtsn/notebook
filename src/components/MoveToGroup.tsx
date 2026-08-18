import { Check, Folder, FolderOpen } from 'lucide-react';
import type { Group } from '../types/group';
import { PopoverItem } from './ui/Popover';

/**
 * Renders only the rows, not a popover — the editor toolbar, the context menu, and the
 * command palette each already own a surface. One list, three hosts.
 */
export function MoveToGroup({
  groups,
  currentGroupId,
  onMove,
}: {
  groups: Group[];
  currentGroupId: string | null;
  onMove: (groupId: string | null) => void;
}) {
  return (
    <>
      <PopoverItem onClick={() => onMove(null)}>
        <FolderOpen size={14} />
        بدون گروه
        {currentGroupId === null && <Check size={13} className="ms-auto text-accent" />}
      </PopoverItem>
      {groups.map(g => (
        <PopoverItem key={g.id} onClick={() => onMove(g.id)}>
          <Folder size={14} />
          <span className="truncate">{g.name}</span>
          {currentGroupId === g.id && <Check size={13} className="ms-auto text-accent" />}
        </PopoverItem>
      ))}
    </>
  );
}
