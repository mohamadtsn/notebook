import { useState, type ReactNode } from 'react';
import { FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { Group, GroupFilter } from '../types/group';
import { MAX_GROUP_NAME } from '../types/group';
import { noteColorVar } from '../types/note';
import { cx } from './ui/cx';
import { IconButton } from './ui/IconButton';
import { Popover, PopoverItem } from './ui/Popover';

interface GroupStripProps {
  groups: Group[];
  counts: Map<GroupFilter, number>;
  selectedId: GroupFilter;
  onSelect: (id: GroupFilter) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Set while a note is being dragged over this group. DESIGN.md §6. */
  dropTargetId: string | null;
}

function Row({
  label,
  color,
  count,
  selected,
  isDropTarget,
  onSelect,
  children,
}: {
  label: string;
  color: string | null;
  count: number;
  selected: boolean;
  isDropTarget: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      className={cx(
        'flex items-center gap-1 transition-colors duration-(--d-fast)',
        selected || isDropTarget ? 'bg-accent-soft' : 'hover:bg-accent-soft/60',
      )}
      style={
        color || isDropTarget
          ? {
              borderInlineStartColor: isDropTarget ? 'var(--accent)' : color!,
              borderInlineStartWidth: 3,
            }
          : undefined
      }
    >
      <button
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className="flex min-h-11 flex-1 items-center gap-2 px-3 text-start text-sm"
      >
        <span className={cx('flex-1 truncate', selected ? 'text-ink' : 'text-ink-soft')}>
          {label}
        </span>
        <span className="shrink-0 text-xs text-muted">{count}</span>
      </button>
      {children}
    </div>
  );
}

export function GroupStrip({
  groups,
  counts,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  dropTargetId,
}: GroupStripProps) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <nav aria-label="گروه‌ها" className="border-b border-separator pb-2">
      <Row
        label="همه"
        color={null}
        count={counts.get('all') ?? 0}
        selected={selectedId === 'all'}
        isDropTarget={false}
        onSelect={() => onSelect('all')}
      />

      {groups.map(g => (
        <div key={g.id} data-group-id={g.id}>
          {renaming === g.id ? (
            <input
              autoFocus
              defaultValue={g.name}
              maxLength={MAX_GROUP_NAME}
              aria-label="نام گروه"
              onBlur={e => {
                onRename(g.id, e.target.value);
                setRenaming(null);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
              className="min-h-11 w-full bg-fill px-3 text-sm text-ink outline-none"
            />
          ) : (
            <Row
              label={g.name}
              color={g.color ? noteColorVar(g.color) : null}
              count={counts.get(g.id) ?? 0}
              selected={selectedId === g.id}
              isDropTarget={dropTargetId === g.id}
              onSelect={() => onSelect(g.id)}
            >
              <Popover
                side="bottom"
                trigger={({ open, toggle }) => (
                  <IconButton label={`گزینه‌های ${g.name}`} active={open} onClick={toggle}>
                    <MoreHorizontal size={15} />
                  </IconButton>
                )}
              >
                {({ close }) => (
                  <>
                    <PopoverItem
                      onClick={() => {
                        setRenaming(g.id);
                        close();
                      }}
                    >
                      <Pencil size={14} /> تغییر نام
                    </PopoverItem>
                    <PopoverItem
                      tone="danger"
                      onClick={() => {
                        onDelete(g.id);
                        close();
                      }}
                    >
                      <Trash2 size={14} /> حذف گروه
                    </PopoverItem>
                  </>
                )}
              </Popover>
            </Row>
          )}
        </div>
      ))}

      <div data-group-id="__none__">
        <Row
          label="بدون گروه"
          color={null}
          count={counts.get(null) ?? 0}
          selected={selectedId === null}
          isDropTarget={dropTargetId === '__none__'}
          onSelect={() => onSelect(null)}
        />
      </div>

      {creating ? (
        <input
          autoFocus
          maxLength={MAX_GROUP_NAME}
          placeholder="نام گروه"
          aria-label="نام گروه جدید"
          onBlur={e => {
            const name = e.target.value.trim();
            if (name) onCreate(name);
            setCreating(false);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setCreating(false);
          }}
          className="min-h-11 w-full bg-fill px-3 text-sm text-ink outline-none"
        />
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex min-h-11 w-full items-center gap-2 px-3 text-start text-sm text-muted transition-colors duration-(--d-fast) hover:text-ink"
        >
          <FolderPlus size={15} /> گروه جدید
        </button>
      )}
    </nav>
  );
}
