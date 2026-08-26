import { lazy, Suspense, useState, useEffect, useLayoutEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Undo2 } from 'lucide-react';
import { easeOut } from '../lib/motion';
import type { Note, NoteColor } from '../types/note';
import type { Group } from '../types/group';
import { useDebounce } from '../hooks/useDebounce';
import { useHistory } from '../hooks/useHistory';
import { useTextDirection } from '../hooks/useTextDirection';
import { renderMarkdown } from '../utils/markdown';
import { isCoarsePointer } from '../utils/device';
import { EditorToolbar, type EditorMode } from './EditorToolbar';
import { EditorContextMenu } from './EditorContextMenu';
import { AiResult } from './AiResult';
import { useToast } from './ui/toast-context';
import type { AiTask } from '../utils/aiCache';
import type { Settings } from '../types/settings';
import type { CodeEditorHandle } from './CodeEditor';

// Lazily imported so the CodeMirror chunk is downloaded only by users who turn the
// experimental editor on. Everyone else never pays for it.
const CodeEditor = lazy(() => import('./CodeEditor').then(m => ({ default: m.CodeEditor })));

interface EditorProps {
  note: Note;
  isTrash?: boolean;
  onUpdate: (id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'color' | 'pinned' | 'dir'>>) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onSetColor: (id: string, color: NoteColor | null) => void;
  groups: Group[];
  onSetGroup: (id: string, groupId: string | null) => void;
  settings: Settings;
  token: string | null;
  onOpenSettings: () => void;
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
  groups,
  onSetGroup,
  settings,
  token,
  onOpenSettings,
}: EditorProps) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<EditorMode>('write');
  // The selection is captured when the menu opens, not read later: the textarea loses
  // it the moment a menu item takes focus.
  const [menu, setMenu] = useState<
    { x: number; y: number; value: string; from: number; to: number; keyboard: boolean } | null
  >(null);

  const openMenuAt = (x: number, y: number, el: HTMLTextAreaElement, keyboard = false) => setMenu({
    x, y, keyboard,
    value: el.value,
    from: Math.min(el.selectionStart, el.selectionEnd),
    to: Math.max(el.selectionStart, el.selectionEnd),
  });
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const cmRef = useRef<CodeEditorHandle | null>(null);
  const advanced = settings.experimentalEditor;
  const coarse = isCoarsePointer();

  /**
   * Whether the body currently holds a range. Only ever used to decide whether the
   * toolbar's selection button is offered — the menu itself still reads the selection
   * at the moment it opens, because that is the value the actions must act on.
   */
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    // One document-level listener covers both bodies: a `<textarea>` reports its own
    // selection changes here, and CodeMirror's contenteditable moves the document
    // selection. Neither needs debouncing — this only flips a boolean.
    const read = () => {
      const sel = advanced
        ? cmRef.current?.selection()
        : bodyRef.current && {
            from: bodyRef.current.selectionStart,
            to: bodyRef.current.selectionEnd,
          };
      setHasSelection(!!sel && sel.from !== sel.to);
    };
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, [advanced]);

  // Undo history outlives this component: it is keyed by note id and persisted, so it
  // survives note switches, the preview toggle, and a reload. See utils/history.ts.
  const history = useHistory(note.id, note.body);
  const { toast } = useToast();

  /** The AI popover, opened from the context menu and anchored where it was. */
  const [ai, setAi] = useState<
    { x: number; y: number; task: AiTask; text: string; from: number; to: number } | null
  >(null);

  const debouncedTitle = useDebounce(title, 500);
  const debouncedBody  = useDebounce(body, 500);

  const titleDir = useTextDirection(title);
  // Only the body: a title is one line, and pinning it is not what the control promises.
  const bodyDir  = useTextDirection(body, note.dir);

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
    if (advanced) return;   // CodeMirror sizes itself
    const el = bodyRef.current;
    if (!el) return;
    const scroller = el.parentElement;
    const top = scroller?.scrollTop ?? 0;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    if (scroller) scroller.scrollTop = top;
  }, [body, mode, advanced]);

  // Persistence is synchronous inside the state updater (see useNotes), so
  // "not waiting on the debounce" is the same thing as "saved" — no timer needed.
  const pending = title !== debouncedTitle || body !== debouncedBody;
  const saveStatus = !touched ? 'idle' : pending ? 'saving' : 'saved';

  // Shared inline padding: the text column is the sheet, edge to edge.
  const gutter = 'px-5 sm:px-8 lg:px-12';

  /**
   * Click-to-write. The guard matters: without it, a click that lands on the title,
   * the textarea, the toolbar, or the trash banner would be hijacked and move the
   * caret away from where the user actually pressed.
   *
   * The caret goes to the END of the body, not index 0 — clicking below a document
   * means "keep writing", not "jump to the top".
   *
   * `preventDefault` is what makes this work at all: mousedown's default action moves
   * focus to the nearest focusable ancestor, and these wrappers are not focusable, so
   * the browser would blur the textarea again the instant this handler returned.
   */
  const focusBody = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    if (isTrash || mode === 'preview') return;
    e.preventDefault();
    if (advanced) return cmRef.current?.focusEnd();
    const el = bodyRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };

  /**
   * Shift passes straight through to the browser's own menu — Persian spellcheck
   * suggestions live there and taking them away is a regression, not a redesign.
   * The same applies wherever the menu's actions cannot apply: preview and trash.
   *
   * On a coarse pointer this bails entirely, `preventDefault` included. The long press
   * is how the platform selects text, and Chrome fires `contextmenu` when that timer
   * elapses — before the selection handles settle, so the range read here is a bare
   * caret — while suppressing the default takes away the OS callout that carries
   * select-all, paste and the handles themselves. There is no Shift key on a phone to
   * get any of it back. The toolbar button below is the door instead.
   */
  const openMenu = (e: React.MouseEvent) => {
    if (coarse) return;
    if (e.shiftKey || isTrash || mode === 'preview') return;
    const el = bodyRef.current;
    if (!el) return;
    e.preventDefault();
    openMenuAt(e.clientX, e.clientY, el);
  };

  /**
   * The toolbar's selection button. Anchored under its own rect, and — the point of the
   * whole detour — the selection is read *now*, on an explicit tap, by which time the
   * platform's handles have long since settled.
   */
  const openSelectionMenu = (x: number, y: number) => {
    if (isTrash || mode === 'preview') return;
    if (advanced) {
      const sel = cmRef.current?.selection();
      if (sel) setMenu({ x, y, keyboard: false, ...sel });
      return;
    }
    const el = bodyRef.current;
    if (el) openMenuAt(x, y, el);
  };

  /** Shift+F10 / the Menu key, anchored to the textarea. DESIGN.md §6, §8. */
  const onBodyKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      applyStep(e.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      applyStep('redo');
      return;
    }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const el = e.currentTarget as HTMLTextAreaElement;
      const r = el.getBoundingClientRect();
      openMenuAt(r.left + 24, r.top + 24, el, true);
    }
  };

  /**
   * The single write path for programmatic edits (menu actions, AI replacement). It goes
   * through the ordinary draft state, so the 500ms debounce, the `dirty` stamp and the
   * save indicator all behave as if the user had typed it — and it is recorded in the
   * history, so it is undoable like any other edit.
   */
  const applyBody = (value: string, start: number, end: number) => {
    setBody(value);
    setTouched(true);
    // `discrete`: a menu action is one deliberate act, so it gets its own undo step
    // instead of merging into whatever was typed a moment earlier.
    history.push({ value, start, end }, true);
    // The value lands on the next render, so the selection is restored after it.
    requestAnimationFrame(() => {
      if (advanced) return cmRef.current?.select(start, end);
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });
  };

  const replaceRange = (from: number, to: number, text: string) => {
    applyBody(body.slice(0, from) + text + body.slice(to), from + text.length, from + text.length);
  };

  /**
   * Our history replaces the browser's, so the native shortcuts have to be taken over:
   * leaving them alone would run the element's own (now out-of-sync) stack alongside ours.
   */
  const applyStep = (dir: 'undo' | 'redo') => {
    const entry = history.step(dir);
    if (!entry) return;
    setBody(entry.value);
    setTouched(true);
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(entry.start, entry.end);
    });
  };

  return (
    // Keyed on the note id by App, so this plays on every note switch.
    // The card fills the pane and starts at the pane's top edge — the navbar
    // floats over it, and the text below scrolls under that glass. DESIGN.md §2.
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: easeOut }}
      onMouseDown={focusBody}
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
          groups={groups}
          onMove={groupId => onSetGroup(note.id, groupId)}
          isTrash={isTrash}
          mode={mode}
          onModeChange={setMode}
          onTogglePin={onTogglePin}
          onSetColor={onSetColor}
          onSetDir={dir => onUpdate(note.id, { dir })}
          onExport={format => exportNote(note, format)}
          onTrash={onTrash}
          onRestore={onRestore}
          onPermanentDelete={onPermanentDelete}
          onSelectionMenu={!isTrash && mode === 'write' && (coarse || hasSelection)
            ? openSelectionMenu
            : undefined}
        />
      </div>

      {/* One scroll container for the whole document — title included, because a
          title is part of the page, not a form field pinned above it. */}
      <div onMouseDown={focusBody} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-18 pb-10">
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

        {mode === 'preview' && (
          <div
            className={`markdown-preview py-3 ${gutter}`}
          dir={bodyDir}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
          />
        )}

        {/* Hidden in preview, never unmounted: the browser's undo stack belongs to the
            element, so unmounting this to show the preview threw away every Ctrl+Z the
            user had.

            Height is driven by content (see the effect above) so the *page* scrolls,
            not a box inside it. A nested scroller here also put a scrollbar on an
            empty note. */}
        {advanced ? (
          /* No spinner: the chunk resolves in a frame, and a flash of loading UI where
             the text will be is worse than a beat of nothing. */
          <Suspense fallback={<div className={`py-3 ${gutter}`} />}>
            <div className={`py-3 ${gutter}`}>
              <CodeEditor
                ref={cmRef}
                noteId={note.id}
                value={body}
                onChange={v => { setBody(v); setTouched(true); }}
                dir={bodyDir}
                disabled={isTrash}
                hidden={mode === 'preview'}
                onRequestMenu={(x, y, keyboard) => {
                  const sel = cmRef.current?.selection();
                  if (!sel) return;
                  setMenu({ x, y, keyboard, ...sel });
                }}
              />
            </div>
          </Suspense>
        ) : (
          <textarea
            hidden={mode === 'preview'}
            ref={bodyRef}
            value={body}
            onChange={e => {
              setBody(e.target.value);
              setTouched(true);
              history.push({
                value: e.target.value,
                start: e.target.selectionStart,
                end: e.target.selectionEnd,
              });
            }}
            onContextMenu={openMenu}
            onKeyDown={onBodyKeyDown}
            placeholder="شروع کنید به نوشتن..."
            aria-label="متن یادداشت"
            dir={bodyDir}
            disabled={isTrash}
            rows={1}
            className={`w-full resize-none overflow-hidden border-none bg-transparent py-3 text-base leading-[1.8] text-ink outline-none placeholder:text-muted disabled:opacity-60 ${gutter}`}
          />
        )}
      </div>

      {menu && (
        <EditorContextMenu
          x={menu.x}
          y={menu.y}
          value={menu.value}
          from={menu.from}
          to={menu.to}
          groups={groups}
          currentGroupId={note.groupId}
          onReplace={replaceRange}
          onAi={task => setAi({
            x: menu.x, y: menu.y, task,
            text: menu.value.slice(menu.from, menu.to),
            from: menu.from, to: menu.to,
          })}
          autoFocus={menu.keyboard}
          onMove={groupId => onSetGroup(note.id, groupId)}
          onClose={() => { setMenu(null); if (advanced) cmRef.current?.select(menu.from, menu.to); else bodyRef.current?.focus(); }}
        />
      )}

      {ai && (
        <AiResult
          x={ai.x}
          y={ai.y}
          task={ai.task}
          text={ai.text}
          settings={settings}
          token={token}
          onReplace={result => {
            /**
             * The offsets were captured before the request. If the text there is no
             * longer what was sent — the user kept editing while it was in flight —
             * writing to them would destroy something they never asked to replace.
             * The result is not thrown away either; it goes in at the caret.
             */
            if (body.slice(ai.from, ai.to) === ai.text) {
              applyBody(
                body.slice(0, ai.from) + result + body.slice(ai.to),
                ai.from, ai.from + result.length,
              );
              return;
            }
            const at = advanced
              ? cmRef.current?.selection().from ?? body.length
              : bodyRef.current?.selectionStart ?? body.length;
            applyBody(body.slice(0, at) + result + body.slice(at), at, at + result.length);
            toast('متن از زمان درخواست تغییر کرده بود؛ نتیجه در محل مکان‌نما درج شد');
          }}
          onOpenSettings={() => { setAi(null); onOpenSettings(); }}
          onClose={() => setAi(null)}
        />
      )}

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
