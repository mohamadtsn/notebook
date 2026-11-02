import { useMemo, useRef, useState, type RefObject } from 'react';
import { ArrowDownAZ, Clock, History, Search, Trash2, X } from 'lucide-react';
import type { Note } from '../types/note';
import type { Group, GroupFilter } from '../types/group';
import { NoteItem } from './NoteItem';
import { NoteContextMenu } from './NoteContextMenu';
import { GroupStrip } from './GroupStrip';
import { IconButton } from './ui/IconButton';
import { cx } from './ui/cx';
import { getItem, setItem } from '../utils/storage';
import { searchNotes } from '../utils/search';
import { useTextDirection } from '../hooks/useTextDirection';

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
  onSelectSearchResult?: (id: string, query: string) => void;
  onOpenSearch: () => void;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
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
  notes, trashedNotes, activeNoteId, view, onViewChange, onSelect, onSelectSearchResult,
  searchQuery: controlledQuery, onSearchQueryChange, searchInputRef,
  groups, groupCounts, selectedGroup, onSelectGroup, onCreateGroup, onRenameGroup, onDeleteGroup,
  onMoveNote, onTogglePin, onTrashNote, onRestoreNote, onPermanentDelete,
}: SidebarProps) {
  const [localQuery, setLocalQuery] = useState('');
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = searchInputRef ?? fallbackInputRef;

  const query = controlledQuery ?? localQuery;
  const setQuery = onSearchQueryChange ?? setLocalQuery;
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const queryDir = useTextDirection(query);

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

  const allGroupsMap = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);

  const source = view === 'notes' ? notes : trashedNotes;
  // Trash is a flat view: a trashed note's group is not what the user is looking for there.
  const filtered = useMemo(
    () => (
      view === 'trash' || selectedGroup === 'all'
        ? source
        : source.filter(n => (n.groupId ?? null) === selectedGroup)
    ),
    [view, selectedGroup, source],
  );

  // Only «همه» shows the badge, and only outside the trash: a trashed note's group is
  // not what anyone is looking for there, and the trash view is flat already.
  const byId = selectedGroup === 'all' && view === 'notes' ? allGroupsMap : null;

  const searchResults = useMemo(
    () => (hasQuery ? searchNotes(filtered, trimmedQuery, allGroupsMap) : []),
    [hasQuery, filtered, trimmedQuery, allGroupsMap],
  );

  const searchResultById = useMemo(
    () => new Map(searchResults.map(r => [r.note.id, r])),
    [searchResults],
  );

  // When a user searches inside a specific group and gets 0 matches, check whether matches
  // exist across all active notes so the empty state can offer a direct 1-tap switch (R-27).
  const globalMatchCount = useMemo(() => {
    if (!hasQuery || view !== 'notes' || selectedGroup === 'all' || searchResults.length > 0) {
      return 0;
    }
    return searchNotes(notes, trimmedQuery, allGroupsMap).length;
  }, [hasQuery, view, selectedGroup, searchResults.length, notes, trimmedQuery, allGroupsMap]);

  const displayedNotes = useMemo(() => {
    if (hasQuery) {
      return searchResults.map(r => r.note);
    }
    return [...filtered].sort((a, b) => {
      // Pinned first, but only where pinning means anything
      if (view === 'notes') {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
      }
      return compare(a, b, sort);
    });
  }, [hasQuery, searchResults, filtered, view, sort]);

  const handleRowSelect = (id: string) => {
    if (hasQuery && onSelectSearchResult) {
      onSelectSearchResult(id, trimmedQuery);
    } else {
      onSelect(id);
    }
  };

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
          <label
            className={cx(
              'group flex min-w-0 flex-1 cursor-text items-center gap-2 rounded-lg bg-fill px-3 py-2',
              'ring-1 ring-transparent transition-[background-color,box-shadow] duration-(--d-fast) ease-(--ease-out-strong)',
              'focus-within:bg-surface focus-within:ring-2 focus-within:ring-accent focus-within:shadow-[0_0_0_4px_var(--accent-soft)]',
            )}
          >
            <Search size={14} className="shrink-0 text-muted" aria-hidden="true" />
            <input
              ref={inputRef}
              data-sidebar-search="true"
              type="text"
              size={1}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (query) {
                    setQuery('');
                  } else {
                    e.currentTarget.blur();
                  }
                } else if (e.key === 'Enter' && displayedNotes.length > 0) {
                  e.preventDefault();
                  handleRowSelect(displayedNotes[0].id);
                }
              }}
              dir={query ? queryDir : 'rtl'}
              placeholder={view === 'trash' ? 'جستجو در سطل زباله…' : 'جستجو…'}
              aria-label="جستجو در لیست یادداشت‌ها"
              className="w-full min-w-0 flex-1 bg-transparent text-right text-sm text-ink outline-none placeholder:text-right placeholder:text-muted"
            />
            {query ? (
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="پاک کردن جستجو"
                className="flex size-5 shrink-0 items-center justify-center rounded text-muted transition-[color,transform] duration-(--d-press) hover:text-ink focus-visible:outline-none active:scale-[0.97]"
              >
                <X size={14} />
              </button>
            ) : (
              <kbd className="pointer-events-none shrink-0 font-mono text-[.6875rem] text-muted group-focus-within:hidden">
                Ctrl K
              </kbd>
            )}
          </label>

          <IconButton label={current.label} onClick={cycleSort}>
            <SortIcon size={16} />
          </IconButton>
        </div>

        {hasQuery && displayedNotes.length > 0 && (
          <div
            aria-live="polite"
            className="flex items-center justify-between border-b border-separator px-4 pb-1.5 text-[.6875rem] text-muted"
          >
            <span>{displayedNotes.length.toLocaleString('fa-IR')} نتیجه</span>
            {view === 'notes' && selectedGroup !== 'all' && (
              <button
                type="button"
                onClick={() => onSelectGroup('all')}
                className="text-accent transition-opacity duration-(--d-fast) hover:underline"
              >
                جستجو در همه
              </button>
            )}
          </div>
        )}

        {displayedNotes.length === 0 && (
          <div className="mt-8 flex flex-col items-center gap-2.5 px-4 text-center">
            <p className="text-sm text-muted">
              {hasQuery
                ? view === 'notes' && selectedGroup !== 'all'
                  ? 'در این گروه یادداشتی با این عبارت پیدا نشد'
                  : 'یادداشتی با این عبارت پیدا نشد'
                : view === 'trash'
                  ? 'سطل زباله خالی است'
                  : 'هنوز یادداشتی ندارید'}
            </p>
            {hasQuery && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {globalMatchCount > 0 && (
                  <button
                    type="button"
                    onClick={() => onSelectGroup('all')}
                    className="min-h-9 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent transition-transform duration-(--d-press) active:scale-[0.97]"
                  >
                    نمایش {globalMatchCount.toLocaleString('fa-IR')} نتیجه در همهٔ یادداشت‌ها
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    inputRef.current?.focus();
                  }}
                  className="min-h-9 rounded-lg bg-fill px-3 py-1.5 text-xs font-medium text-ink-soft transition-[color,transform] duration-(--d-press) hover:text-ink active:scale-[0.97]"
                >
                  پاک کردن جستجو
                </button>
              </div>
            )}
          </div>
        )}

        {displayedNotes.map(note => (
          <NoteItem
            key={note.id}
            note={note}
            isActive={note.id === activeNoteId}
            onClick={() => handleRowSelect(note.id)}
            draggable={canDrag && view === 'notes' && !hasQuery}
            onDragHover={setDropTargetId}
            onDragToGroup={groupId => onMoveNote(note.id, groupId)}
            onContextMenu={(x, y) => setMenu({ x, y, note })}
            // `get` on a null groupId misses, and so does a group id that sync has not
            // delivered yet — both correctly render no badge rather than a broken one.
            group={byId?.get(note.groupId ?? '') ?? undefined}
            searchResult={searchResultById.get(note.id)}
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
