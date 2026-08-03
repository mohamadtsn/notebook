import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Undo2 } from 'lucide-react';
import { easeOut } from '../lib/motion';
import type { Note, NoteColor } from '../types/note';
import { useDebounce } from '../hooks/useDebounce';
import { useTextDirection } from '../hooks/useTextDirection';
import { renderMarkdown } from '../utils/markdown';
import { EditorToolbar, type EditorMode } from './EditorToolbar';

interface EditorProps {
  note: Note;
  isTrash?: boolean;
  onUpdate: (id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'color' | 'pinned'>>) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onSetColor: (id: string, color: NoteColor | null) => void;
}

function formatTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'همین الان';
  if (minutes < 60) return `${minutes} دقیقه پیش`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours} ساعت پیش`;
  const days = Math.floor(diff / 86400000);
  return `${days} روز پیش`;
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function exportNote(note: Note, format: 'txt' | 'md') {
  const content = format === 'md'
    ? `# ${note.title}\n\n${note.body}`
    : `${note.title}\n${'='.repeat(note.title.length || 1)}\n\n${note.body}`;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${note.title || 'یادداشت'}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Editor({
  note,
  isTrash = false,
  onUpdate,
  onTrash,
  onRestore,
  onPermanentDelete,
  onTogglePin,
  onSetColor,
}: EditorProps) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<EditorMode>('write');
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const debouncedTitle = useDebounce(title, 500);
  const debouncedBody  = useDebounce(body, 500);

  const titleDir = useTextDirection(title);
  const bodyDir  = useTextDirection(body);

  // Deliberately keyed on the debounced draft only: adding `note` would re-fire
  // this on every store update and write the draft back over a newer value.
  useEffect(() => {
    if (debouncedTitle === note.title && debouncedBody === note.body) return;
    onUpdate(note.id, { title: debouncedTitle, body: debouncedBody });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedTitle, debouncedBody]);

  // The document is one scroll container, so the textarea has to be as tall as
  // its text — otherwise it scrolls inside the page instead of with it.
  // Collapsing to `auto` shrinks the page, so the browser clamps the scroll
  // container's scrollTop before the new height is applied — that clamp is what
  // jumped the view upward while typing near the bottom. Restore it in the same
  // layout pass, before paint.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const scroller = el.parentElement;
    const top = scroller?.scrollTop ?? 0;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    if (scroller) scroller.scrollTop = top;
  }, [body, mode]);

  // Persistence is synchronous inside the state updater (see useNotes), so
  // "not waiting on the debounce" is the same thing as "saved" — no timer needed.
  const pending = title !== debouncedTitle || body !== debouncedBody;
  const saveStatus = !touched ? 'idle' : pending ? 'saving' : 'saved';

  // Shared inline padding: the text column is the sheet, edge to edge.
  const gutter = 'px-5 sm:px-8 lg:px-12';

  return (
    // Keyed on the note id by App, so this plays on every note switch.
    // The card fills the pane and starts at the pane's top edge — the navbar
    // floats over it, and the text below scrolls under that glass. DESIGN.md §2.
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: easeOut }}
      onMouseDown={e => {
        // Clicking the sheet's margins should start writing, not do nothing.
        if (e.target === e.currentTarget) bodyRef.current?.focus();
      }}
      className={[
        'relative flex h-full flex-col overflow-hidden rounded-2xl border border-separator bg-surface shadow-e2',
        'transition-[border-color] duration-(--d-base) ease-out-strong',
        // The lit sheet *is* the focus indicator for the title and body — a
        // ring drawn around a page of writing is noise. DESIGN.md §8.
        'focus-within:border-accent/40',
      ].join(' ')}
    >
      {/* Floating pill, not a toolbar row: it stays put while the text moves
          under it, so it never competes with the page for vertical space. */}
      <div className="absolute inset-e-3 top-3 z-20 sm:inset-e-5">
        <EditorToolbar
          note={note}
          isTrash={isTrash}
          mode={mode}
          onModeChange={setMode}
          onTogglePin={onTogglePin}
          onSetColor={onSetColor}
          onExport={format => exportNote(note, format)}
          onTrash={onTrash}
          onRestore={onRestore}
          onPermanentDelete={onPermanentDelete}
        />
      </div>

      {/* One scroll container for the whole document — title included, because a
          title is part of the page, not a form field pinned above it. */}
      <div className="min-h-0 flex-1 overflow-y-auto pt-18 pb-10">
        {isTrash && (
          <div className={`mb-4 flex items-center justify-between rounded-lg bg-destructive/10 py-2 ${gutter}`}>
            <span className="text-xs text-destructive">این یادداشت در سطل زباله است</span>
            <button
              onClick={() => onRestore(note.id)}
              className="flex items-center gap-1 rounded-md px-1 py-1 text-xs text-destructive transition-transform duration-(--d-press) hover:underline active:scale-[.97]"
            >
              <Undo2 size={12} />
              بازگرداندن
            </button>
          </div>
        )}

        {/* No border under the title: the size jump already separates it, and a
            rule there read as a form field rather than a document. */}
        <input
          type="text"
          value={title}
          onChange={e => { setTitle(e.target.value); setTouched(true); }}
          placeholder="عنوان"
          aria-label="عنوان یادداشت"
          dir={titleDir}
          disabled={isTrash}
          className={`w-full border-none bg-transparent pb-1 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-ink outline-none placeholder:text-muted disabled:opacity-60 ${gutter}`}
        />

        {mode === 'preview' ? (
          <div
            className={`markdown-preview py-3 ${gutter}`}
            dir={bodyDir}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
          />
        ) : (
          // Height is driven by content (see the effect above) so the *page*
          // scrolls, not a box inside it. A nested scroller here also put a
          // scrollbar on an empty note.
          <textarea
            ref={bodyRef}
            value={body}
            onChange={e => { setBody(e.target.value); setTouched(true); }}
            placeholder="شروع کنید به نوشتن..."
            aria-label="متن یادداشت"
            dir={bodyDir}
            disabled={isTrash}
            rows={1}
            className={`w-full resize-none overflow-hidden border-none bg-transparent py-3 text-base leading-[1.8] text-ink outline-none placeholder:text-muted disabled:opacity-60 ${gutter}`}
          />
        )}
      </div>

      {/* Footer holds status only — every action moved to the toolbar */}
      <div className={`flex shrink-0 items-center gap-2 border-t border-separator py-2.5 text-xs text-muted ${gutter}`}>
        <span>{wordCount(body)} کلمه</span>
        <span aria-hidden>·</span>
        <span>{formatTime(note.updatedAt)}</span>
        <span aria-live="polite" className="ms-auto">
          <AnimatePresence mode="wait" initial={false}>
            {saveStatus !== 'idle' && (
              <motion.span
                key={saveStatus}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15, ease: easeOut }}
                className={saveStatus === 'saved' ? 'block text-success' : 'block'}
              >
                {saveStatus === 'saving' ? 'در حال ذخیره…' : 'ذخیره شد'}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </div>
    </motion.div>
  );
}
