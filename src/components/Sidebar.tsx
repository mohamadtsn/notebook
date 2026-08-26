import { useState } from 'react';
import { ArrowDownAZ, Clock, History, Search, Trash2 } from 'lucide-react';
import type { Note } from '../types/note';
import type { Group, GroupFilter } from '../types/group';
import { NoteItem } from './NoteItem';
import { NoteContextMenu } from './NoteContextMenu';
import { GroupStrip } from './GroupStrip';
import { IconButton } from './ui/IconButton';
import { cx } from './ui/cx';
import { getItem, setItem } from '../utils/storage';

type SortOrder = 'newest' | 'oldest' | 'alpha';
type View = 'notes' | 'trash';

const SORT_KEY = 'notebook_sort';

/** Cycled by one button rather than a menu — three options don't earn a popover. */
const SORTS = [
  { value: 'newest', label: 'مرتب‌سازی: جدیدترین', icon: Clock },
  { value: 'oldest', label: 'مرتب‌سازی: قدیمی‌ترین', icon: History },
  { value: 'alpha',  label: 'مرتب‌سازی: الفبا', icon: ArrowDownAZ },
] as const;

function compare(a: Note, b: Note, sort: SortOrder): number {
  if (sort === 'newest') return b.updatedAt - a.updatedAt;
  if (sort === 'oldest') return a.updatedAt - b.updatedAt;
  return a.title.localeCompare(b.title, 'fa');
}

interface SidebarProps {
  notes: Note[];
  trashedNotes: Note[];
  activeNoteId: string | null;
  view: View;
  onViewChange: (v: View) => void;
  onSelect: (id: string) => void;
  onOpenSearch: () => void;
  groups: Group[];
  groupCounts: Map<GroupFilter, number>;
  selectedGroup: GroupFilter;
  onSelectGroup: (id: GroupFilter) => void;
  onCreateGroup: (name: string) => void;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;
  onMoveNote: (id: string, groupId: string | null) => void;
  onTogglePin: (id: string) => void;
  onTrashNote: (id: string) => void;
  onRestoreNote: (id: string) => void;
  onPermanentDelete: (id: string) => void;
}

export function Sidebar({
  notes, trashedNotes, activeNoteId, view, onViewChange, onSelect, onOpenSearch,
  groups, groupCounts, selectedGroup, onSelectGroup, onCreateGroup, onRenameGroup, onDeleteGroup,
  onMoveNote, onTogglePin, onTrashNote, onRestoreNote, onPermanentDelete,
}: SidebarProps) {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // One row menu at a time; the row it belongs to is carried with the coordinates so
  // the menu keeps showing the right actions while the list re-sorts underneath it.
  const [menu, setMenu] = useState<{ x: number; y: number; note: Note } | null>(null);

  // Touch drag would fight the sidebar sheet's own drag-to-dismiss (App.tsx), and the
  // menu path already covers touch. DESIGN.md §6.
  const canDrag = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const [sort, setSort] = useState<SortOrder>(() => getItem<SortOrder>(SORT_KEY, 'newest'));

  const cycleSort = () => {
    const next = SORTS[(SORTS.findIndex(s => s.value === sort) + 1) % SORTS.length].value;
    setItem(SORT_KEY, next);
    setSort(next);
  };

  const current = SORTS.find(s => s.value === sort) ?? SORTS[0];
  const SortIcon = current.icon;

  const source = view === 'notes' ? notes : trashedNotes;
  // Trash is a flat view: a trashed note's group is not what the user is looking for there.
  const filtered =
    view === 'trash' || selectedGroup === 'all'
      ? source
      : source.filter(n => (n.groupId ?? null) === selectedGroup);

  // Only «همه» shows the badge, and only outside the trash: a trashed note's group is
  // not what anyone is looking for there, and the trash view is flat already.
  const byId = selectedGroup === 'all' && view === 'notes'
    ? new Map(groups.map(g => [g.id, g]))
    : null;

  const sorted = [...filtered].sort((a, b) => {
    // Pinned first, but only where pinning means anything
    if (view === 'notes') {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
    }
    return compare(a, b, sort);
  });

  return (
    // A solid floating card, deliberately *not* glass: the navbar is the glass
    // layer and it hovers over this one. Two translucent planes stacked would
    // cancel each other out — DESIGN.md §2.
    <aside className="flex h-full w-72 flex-col overflow-hidden rounded-2xl border border-separator bg-surface shadow-e2">
      {/* One scroll container: the search row scrolls with the list rather than
          pinning, so there's no seam between a fixed strip and moving rows. */}
      {/* A vertical scroller has to say so on BOTH axes: CSS promotes the other axis
          from `visible` to `auto` as soon as one axis scrolls, and IconButton's 44px
          touch pad (`after:-inset-1`) reaches 4px past its own box — which was enough
          to give this list a stray horizontal scrollbar. */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-3">
        {view === 'notes' && (
          <GroupStrip
            groups={groups}
            counts={groupCounts}
            selectedId={selectedGroup}
            onSelect={onSelectGroup}
            onCreate={onCreateGroup}
            onRename={onRenameGroup}
            onDelete={onDeleteGroup}
            dropTargetId={dropTargetId}
          />
        )}

        <div className="flex items-center gap-1 px-3 pb-2 pt-2">
          {/* Search is the command palette now — this button just opens it */}
          <button
            onClick={onOpenSearch}
            className="flex flex-1 items-center gap-2 rounded-lg bg-fill px-3 py-2 text-start text-sm text-muted transition-colors duration-(--d-fast) hover:text-ink"
          >
            <Search size={14} className="shrink-0" />
            <span className="flex-1">جستجو…</span>
            <kbd className="shrink-0 font-mono text-[.6875rem] text-muted">Ctrl K</kbd>
          </button>

          <IconButton label={current.label} onClick={cycleSort}>
            <SortIcon size={16} />
          </IconButton>
        </div>

        {sorted.length === 0 && (
          <p className="mt-8 px-4 text-center text-sm text-muted">
            {view === 'trash' ? 'سطل زباله خالی است' : 'هنوز یادداشتی ندارید'}
          </p>
        )}
        {sorted.map(note => (
          <NoteItem
            key={note.id}
            note={note}
            isActive={note.id === activeNoteId}
            onClick={() => onSelect(note.id)}
            draggable={canDrag && view === 'notes'}
            onDragHover={setDropTargetId}
            onDragToGroup={groupId => onMoveNote(note.id, groupId)}
            onContextMenu={(x, y) => setMenu({ x, y, note })}
            // `get` on a null groupId misses, and so does a group id that sync has not
            // delivered yet — both correctly render no badge rather than a broken one.
            group={byId?.get(note.groupId ?? '') ?? undefined}
          />
        ))}
      </div>

      <div
        className="flex shrink-0 border-t border-separator"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {([
          { value: 'notes', label: 'یادداشت‌ها', icon: null },
          { value: 'trash', label: 'سطل زباله', icon: <Trash2 size={13} /> },
        ] as const).map(tab => (
          <button
            key={tab.value}
            onClick={() => onViewChange(tab.value)}
            aria-current={view === tab.value ? 'page' : undefined}
            className={cx(
              'flex flex-1 items-center justify-center gap-1.5 py-3.5 text-xs font-medium',
              'transition-colors duration-[var(--d-fast)]',
              view === tab.value ? 'text-accent' : 'text-muted hover:text-ink',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      {menu && (
        <NoteContextMenu
          x={menu.x}
          y={menu.y}
          note={menu.note}
          onTogglePin={onTogglePin}
          onTrash={onTrashNote}
          onRestore={onRestoreNote}
          onPermanentDelete={onPermanentDelete}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}
