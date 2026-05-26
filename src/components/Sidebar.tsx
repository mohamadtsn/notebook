import { useState, forwardRef } from 'react';
import { Search, ArrowDownAZ, Clock, Trash2 } from 'lucide-react';
import type { Note } from '../types/note';
import { NoteItem } from './NoteItem';

type SortOrder = 'newest' | 'alpha';
type View = 'notes' | 'trash';

interface SidebarProps {
  notes: Note[];
  trashedNotes: Note[];
  activeNoteId: string | null;
  view: View;
  onViewChange: (v: View) => void;
  onSelect: (id: string) => void;
}

export const Sidebar = forwardRef<HTMLInputElement, SidebarProps>(
  ({ notes, trashedNotes, activeNoteId, view, onViewChange, onSelect }, searchRef) => {
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState<SortOrder>('newest');

    const source = view === 'notes' ? notes : trashedNotes;

    const filtered = query
      ? source.filter(n =>
          n.title.toLowerCase().includes(query.toLowerCase()) ||
          n.body.toLowerCase().includes(query.toLowerCase())
        )
      : source;

    const sorted = [...filtered].sort((a, b) => {
      // Pinned first (only in notes view)
      if (view === 'notes') {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
      }
      if (sort === 'newest') return b.updatedAt - a.updatedAt;
      return a.title.localeCompare(b.title, 'fa');
    });

    return (
      <aside className="w-70 border-r border-border bg-paper flex flex-col h-full">
        {/* Search + sort */}
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              type="text"
              placeholder="جستجو... (Ctrl+K)"
              value={query}
              onChange={e => setQuery(e.target.value)}
              dir="rtl"
              className="w-full pr-8 pl-3 py-1.5 text-sm bg-paper border border-border rounded-md placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent text-right text-ink"
            />
          </div>
          <button
            onClick={() => setSort(s => (s === 'newest' ? 'alpha' : 'newest'))}
            title={sort === 'newest' ? 'مرتب: جدیدترین' : 'مرتب: الفبا'}
            className="p-1.5 rounded-md text-muted hover:bg-border transition-colors shrink-0"
          >
            {sort === 'newest' ? <Clock size={15} /> : <ArrowDownAZ size={15} />}
          </button>
        </div>

        {/* Note list */}
        <div className="flex-1 overflow-y-auto">
          {sorted.length === 0 && (
            <p className="text-center text-sm text-muted mt-8 px-4">
              {query ? 'یادداشتی یافت نشد' : view === 'trash' ? 'سطل زباله خالی است' : 'هنوز یادداشتی ندارید'}
            </p>
          )}
          {sorted.map(note => (
            <NoteItem
              key={note.id}
              note={note}
              isActive={note.id === activeNoteId}
              onClick={() => onSelect(note.id)}
            />
          ))}
        </div>

        {/* Bottom nav */}
        <div className="border-t border-border flex">
          <button
            onClick={() => onViewChange('notes')}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              view === 'notes' ? 'text-accent' : 'text-muted hover:text-ink'
            }`}
          >
            یادداشت‌ها
          </button>
          <button
            onClick={() => onViewChange('trash')}
            className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1 transition-colors ${
              view === 'trash' ? 'text-accent' : 'text-muted hover:text-ink'
            }`}
          >
            <Trash2 size={12} />
            سطل زباله
          </button>
        </div>
      </aside>
    );
  }
);
Sidebar.displayName = 'Sidebar';