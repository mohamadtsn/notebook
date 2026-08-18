import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileText, Folder, FolderOpen, Moon, Plus, Settings2, Sun, Trash2 } from 'lucide-react';
import type { Group } from '../types/group';
import type { Note } from '../types/note';
import { cx } from './ui/cx';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
  /** Actions that open a second level inside the palette rather than dismissing it. */
  keepOpen?: boolean;
}

interface CommandPaletteProps {
  onClose: () => void;
  notes: Note[];
  dark: boolean;
  onSelectNote: (id: string) => void;
  onNewNote: () => void;
  onToggleDark: () => void;
  onOpenTrash: () => void;
  onOpenSettings: () => void;
  groups: Group[];
  /** null while no note is open — the move action is hidden in that case. */
  activeNote: Note | null;
  onMoveToGroup: (groupId: string | null) => void;
}

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * DESIGN.md §5/§6: keyboard-triggered, so it appears instantly — no enter or
 * exit animation. Anything else here would read as lag.
 *
 * Mounted only while open, so every opening starts from a clean query and cursor
 * without a reset effect.
 */
export function CommandPalette({
  onClose, notes, dark, onSelectNote, onNewNote, onToggleDark, onOpenTrash, onOpenSettings,
  groups, activeNote, onMoveToGroup,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  // Second level, same list and same keys — not a different interaction model.
  const [picking, setPicking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    if (picking) {
      // «بدون گروه» is filtered by the query like any other row: leaving it pinned
      // meant typing a group's name still left "no group" under the cursor, so Enter
      // moved the note out of every group instead of into the one just typed.
      const none: Command[] = !query || matches('بدون گروه', query)
        ? [{
            id: 'move-none',
            label: 'بدون گروه',
            icon: <FolderOpen size={15} />,
            run: () => onMoveToGroup(null),
          }]
        : [];
      return [
        ...none,
        ...groups
          .filter(g => !query || matches(g.name, query))
          .map(g => ({
            id: `move-${g.id}`,
            label: g.name,
            icon: <Folder size={15} />,
            run: () => onMoveToGroup(g.id),
          })),
      ];
    }

    const actions: Command[] = [
      { id: 'new', label: 'یادداشت جدید', hint: 'Ctrl+N', icon: <Plus size={15} />, run: onNewNote },
      {
        id: 'theme',
        label: dark ? 'حالت روشن' : 'حالت تاریک',
        icon: dark ? <Sun size={15} /> : <Moon size={15} />,
        run: onToggleDark,
      },
      { id: 'trash', label: 'سطل زباله', icon: <Trash2 size={15} />, run: onOpenTrash },
      { id: 'settings', label: 'تنظیمات', hint: 'Ctrl+,', icon: <Settings2 size={15} />, run: onOpenSettings },
      ...(activeNote
        ? [{
            id: 'move',
            label: 'انتقال به گروه…',
            icon: <Folder size={15} />,
            run: () => { setPicking(true); setQuery(''); setCursor(0); },
            keepOpen: true,
          }]
        : []),
    ];

    const noteResults: Command[] = notes
      .filter(n => !query || matches(n.title, query) || matches(n.body, query))
      .slice(0, 8)
      .map(n => ({
        id: `note-${n.id}`,
        label: n.title.trim() || 'یادداشت بدون عنوان',
        hint: n.body.trim().slice(0, 40) || undefined,
        icon: <FileText size={15} />,
        run: () => onSelectNote(n.id),
      }));

    const filteredActions = query
      ? actions.filter(a => matches(a.label, query))
      : actions;

    return [...noteResults, ...filteredActions];
  }, [
    notes, query, dark, onNewNote, onToggleDark, onOpenTrash, onOpenSettings, onSelectNote,
    picking, groups, activeNote, onMoveToGroup,
  ]);

  // Keep the highlighted row in view when arrowing past the fold
  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    cmd.run();
    if (!cmd.keepOpen) onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => (commands.length ? (c + 1) % commands.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => (commands.length ? (c - 1 + commands.length) % commands.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(commands[cursor]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Escape backs out of the group picker first, then closes the palette.
      if (picking) { setPicking(false); setQuery(''); setCursor(0); }
      else onClose();
    }
  };

  return (
    <div
      className="scrim fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]"
      onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="جستجو و دستورها"
        onKeyDown={onKeyDown}
        className="glass-overlay w-full max-w-xl overflow-hidden rounded-2xl"
      >
        <input
          autoFocus
          value={query}
          onChange={e => { setQuery(e.target.value); setCursor(0); }}
          placeholder={picking ? 'انتقال به کدام گروه؟' : 'جستجو در یادداشت‌ها یا اجرای یک دستور...'}
          aria-label={picking ? 'انتخاب گروه' : 'جستجو'}
          className="w-full border-b border-separator bg-transparent px-4 py-3.5 text-sm text-ink outline-none placeholder:text-muted"
        />

        <div ref={listRef} role="listbox" className="max-h-80 overflow-y-auto overflow-x-hidden p-1.5">
          {commands.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted">چیزی پیدا نشد</p>
          )}
          {commands.map((cmd, i) => (
            <button
              key={cmd.id}
              role="option"
              aria-selected={i === cursor}
              onPointerEnter={() => setCursor(i)}
              onClick={() => run(cmd)}
              className={cx(
                'flex w-full items-center gap-3 rounded-md px-3 py-3 text-start',
                i === cursor ? 'bg-accent-soft text-ink' : 'text-ink-soft',
              )}
            >
              <span className={cx('shrink-0', i === cursor ? 'text-accent' : 'text-muted')}>
                {cmd.icon}
              </span>
              <span className="flex-1 truncate text-sm">{cmd.label}</span>
              {cmd.hint && (
                <span className="shrink-0 truncate text-xs text-muted max-w-40">{cmd.hint}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
