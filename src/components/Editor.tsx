import { lazy, Suspense, useState, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Undo2 } from 'lucide-react';
import { easeOut } from '../lib/motion';
import type { Note, NoteColor } from '../types/note';
import type { Group } from '../types/group';
import { useDebounce } from '../hooks/useDebounce';
import { useTextDirection } from '../hooks/useTextDirection';
import { renderMarkdown } from '../utils/markdown';
import { findMatches, replaceMatches, isShortcutKey, type MatchRange } from '../utils/search';
import { isCoarsePointer } from '../utils/device';
import { EditorToolbar, type EditorMode } from './EditorToolbar';
import { EditorSearchBar } from './EditorSearchBar';
import { EditorContextMenu } from './EditorContextMenu';
import { AiResult } from './AiResult';
import { Attachments } from './Attachments';
import { useToast } from './ui/toast-context';
import type { AiTask } from '../utils/aiCache';
import type { Settings } from '../types/settings';
import type { CodeEditorHandle } from './CodeEditor';
import type { Attachment, WireAttachment } from '../types/attachment';

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
  /** The account's tier as the server reports it; `free` while signed out. */
  tier: 'free' | 'pro';
  /** This note's files. Empty and unused unless the strip is rendered. */
  attachments: Attachment[];
  onAttachmentAdded: (wire: WireAttachment) => void;
  onAttachmentRemoved: (id: string) => void;
  onOpenSettings: () => void;
  /** Passed when the note was opened from a list/palette search result. */
  initialSearch?: { query: string; token: number } | null;
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

/** Keeps the title's search highlights visible while the search bar has focus. */
function renderBackdropHighlights(
  text: string,
  ranges: MatchRange[],
  activeRangeIndex: number,
) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const from = Math.max(cursor, Math.min(text.length, r.from));
    const to = Math.max(from, Math.min(text.length, r.to));
    if (from > cursor) {
      parts.push(text.slice(cursor, from));
    }
    if (to > from) {
      const isActive = i === activeRangeIndex;
      parts.push(
        <mark
          key={`${from}-${to}-${i}`}
          data-active-match={isActive ? 'true' : undefined}
          className={
            isActive
              ? 'rounded-[2px] bg-selection text-transparent outline-1 outline-accent'
              : 'rounded-[2px] bg-accent-soft text-transparent'
          }
        >
          {text.slice(from, to)}
        </mark>,
      );
    }
    cursor = to;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts;
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
  tier,
  attachments,
  onAttachmentAdded,
  onAttachmentRemoved,
  onOpenSettings,
  initialSearch,
}: EditorProps) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [storedDraft, setStoredDraft] = useState({ title: note.title, body: note.body });
  if (storedDraft.title !== note.title || storedDraft.body !== note.body) {
    // A remote revision can replace a clean field independently of the other field.
    if (title === storedDraft.title) setTitle(note.title);
    if (body === storedDraft.body) setBody(note.body);
    setStoredDraft({ title: note.title, body: note.body });
  }
  const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<EditorMode>('write');
  // Keep the selection captured when the menu opens.
  const [menu, setMenu] = useState<
    { x: number; y: number; value: string; from: number; to: number; keyboard: boolean } | null
  >(null);

  // In-note search state
  const [searchOpen, setSearchOpen] = useState(() => Boolean(initialSearch?.query.trim()));
  const [searchInstant, setSearchInstant] = useState(true);
  const [searchQuery, setSearchQuery] = useState(() => initialSearch?.query ?? '');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [seenSearchToken, setSeenSearchToken] = useState(initialSearch?.token);

  if (initialSearch && initialSearch.token !== seenSearchToken) {
    setSeenSearchToken(initialSearch.token);
    setSearchQuery(initialSearch.query);
    setSearchOpen(Boolean(initialSearch.query.trim()));
    setSearchInstant(true);
    setActiveMatchIndex(0);
  }

  const titleRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cmRef = useRef<CodeEditorHandle | null>(null);
  const coarse = isCoarsePointer();

  // «مستقیم» mode spends the user's own key on their own device — gating it would be
  // gating something we do not pay for. Only the proxy is behind the tier.
  const aiEnabled = settings.ai.mode === 'direct' || tier === 'pro';

  const hasActiveQuery = searchOpen && (caseSensitive ? searchQuery.length > 0 : searchQuery.trim().length > 0);

  const titleMatches = useMemo(
    () => (hasActiveQuery ? findMatches(title, searchQuery, { caseSensitive, wholeWord }) : []),
    [hasActiveQuery, title, searchQuery, caseSensitive, wholeWord],
  );

  const bodyMatches = useMemo(
    () => (hasActiveQuery ? findMatches(body, searchQuery, { caseSensitive, wholeWord }) : []),
    [hasActiveQuery, body, searchQuery, caseSensitive, wholeWord],
  );

  const totalMatches = titleMatches.length + bodyMatches.length;
  const clampedMatchIndex = totalMatches === 0
    ? -1
    : ((activeMatchIndex % totalMatches) + totalMatches) % totalMatches;

  const activeTitleMatchIndex =
    clampedMatchIndex >= 0 && clampedMatchIndex < titleMatches.length
      ? clampedMatchIndex
      : -1;
  const activeBodyMatchIndex =
    clampedMatchIndex >= titleMatches.length
      ? clampedMatchIndex - titleMatches.length
      : -1;

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    if (mode !== 'write' || isTrash) return;
    if (activeTitleMatchIndex >= 0 && titleMatches[activeTitleMatchIndex]) {
      const m = titleMatches[activeTitleMatchIndex];
      requestAnimationFrame(() => {
        titleRef.current?.focus();
        titleRef.current?.setSelectionRange(m.from, m.to);
      });
      return;
    }
    if (activeBodyMatchIndex >= 0 && bodyMatches[activeBodyMatchIndex]) {
      const m = bodyMatches[activeBodyMatchIndex];
      requestAnimationFrame(() => cmRef.current?.select(m.from, m.to));
    }
  }, [mode, isTrash, activeTitleMatchIndex, titleMatches, activeBodyMatchIndex, bodyMatches]);

  // Ctrl+F / Cmd+F opens the in-note find bar instantly; Escape closes it before
  // `useKeyboardShortcuts` can deselect the note. Registered in capture phase so it
  // runs before `useKeyboardShortcuts`'s bubble-phase fallback when a note is open,
  // and uses `isShortcutKey` so Persian keyboard layout (`KeyF` -> `ب`) never falls
  // through to the browser's native find bar.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && !e.altKey && isShortcutKey(e, 'KeyF', 'f', 'ب', 'إ')) {
        if (document.querySelector('[role="dialog"]')) return;
        e.preventDefault();
        const sel = cmRef.current?.selection();
        if (sel && sel.from !== sel.to) {
          const picked = sel.value.slice(Math.min(sel.from, sel.to), Math.max(sel.from, sel.to));
          if (picked && !picked.includes('\n') && picked.length <= 80) {
            setSearchQuery(picked);
            setActiveMatchIndex(0);
          }
        }
        setSearchInstant(true);
        setSearchOpen(true);
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
        return;
      }

      if (e.key === 'Escape' && searchOpen && !e.defaultPrevented) {
        if (document.querySelector('[role="dialog"]')) return;
        const active = document.activeElement;
        const inEditorField =
          active === titleRef.current
          || (active instanceof HTMLElement && active.isContentEditable);
        if (!inEditorField) {
          e.preventDefault();
          closeSearch();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [searchOpen, closeSearch]);

  useEffect(() => {
    if (mode === 'write' && hasActiveQuery && activeTitleMatchIndex >= 0) {
      titleRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }, [hasActiveQuery, activeTitleMatchIndex, mode]);

  const renderedMarkdown = useMemo(
    () => mode === 'preview' ? renderMarkdown(body, note.dir) : '',
    [body, note.dir, mode],
  );

  // Post-sanitize DOM text-node highlighter for Markdown preview mode.
  // Never touches `renderMarkdown` input, keeping the `html: false` + DOMPurify boundary intact.
  useLayoutEffect(() => {
    if (mode !== 'preview') return;
    const container = previewRef.current;
    if (!container) return;

    container.innerHTML = renderedMarkdown;
    if (!hasActiveQuery) return;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      if (current instanceof Text && current.nodeValue && current.nodeValue.trim().length > 0) {
        textNodes.push(current);
      }
      current = walker.nextNode();
    }

    const matchedMarks: HTMLElement[] = [];

    for (const node of textNodes) {
      const val = node.nodeValue ?? '';
      const ranges = findMatches(val, searchQuery, { caseSensitive, wholeWord });
      if (ranges.length === 0) continue;

      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const r of ranges) {
        if (r.from > cursor) {
          frag.appendChild(document.createTextNode(val.slice(cursor, r.from)));
        }
        const mark = document.createElement('mark');
        mark.className = 'rounded-[2px] bg-accent-soft text-ink px-[1px]';
        mark.textContent = val.slice(r.from, r.to);
        matchedMarks.push(mark);
        frag.appendChild(mark);
        cursor = r.to;
      }
      if (cursor < val.length) {
        frag.appendChild(document.createTextNode(val.slice(cursor)));
      }
      node.parentNode?.replaceChild(frag, node);
    }

    if (matchedMarks.length > 0 && activeBodyMatchIndex >= 0) {
      const activeMarkEl = matchedMarks[activeBodyMatchIndex % matchedMarks.length];
      activeMarkEl.className = 'rounded-[2px] bg-selection text-ink outline-1 outline-accent px-[1px]';
      activeMarkEl.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }, [mode, renderedMarkdown, hasActiveQuery, searchQuery, caseSensitive, wholeWord, activeBodyMatchIndex]);

  const [hasSelection, setHasSelection] = useState(false);
  const { toast } = useToast();

  /** The AI popover, opened from the context menu and anchored where it was. */
  const [ai, setAi] = useState<
    { x: number; y: number; task: AiTask; text: string; from: number; to: number } | null
  >(null);

  const debouncedTitle = useDebounce(title, 500);
  const debouncedBody  = useDebounce(body, 500);

  const titleDir = useTextDirection(title);
  const saveDraft = useEffectEvent((flush: boolean) => {
    if (isTrash) return;
    const patch: { title?: string; body?: string } = {};
    if ((flush || title === debouncedTitle) && title !== note.title) patch.title = title;
    if ((flush || body === debouncedBody) && body !== note.body) patch.body = body;
    if (Object.keys(patch).length) onUpdate(note.id, patch);
  });
  useEffect(() => {
    saveDraft(false);
  }, [debouncedTitle, debouncedBody]);
  useEffect(() => {
    const flush = () => saveDraft(true);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  // Persistence is synchronous inside the state updater (see useNotes), so
  // "not waiting on the debounce" is the same thing as "saved" — no timer needed.
  const pending = title !== debouncedTitle || body !== debouncedBody;
  const saveStatus = !touched ? 'idle' : pending ? 'saving' : 'saved';

  // Shared inline padding: the text column is the sheet, edge to edge.
  const gutter = 'px-5 sm:px-8 lg:px-12';

  const focusBody = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget || isTrash || mode === 'preview') return;
    e.preventDefault();
    cmRef.current?.focusEnd();
  };

  const openSelectionMenu = (x: number, y: number) => {
    const selection = cmRef.current?.selection();
    if (selection) setMenu({ x, y, keyboard: false, ...selection });
  };

  const applyBody = (value: string, start: number, end: number, focusEditor = true) => {
    cmRef.current?.replaceValue(value, start, end, focusEditor);
  };

  const replaceRange = (from: number, to: number, text: string) => {
    applyBody(body.slice(0, from) + text + body.slice(to), from + text.length, from + text.length);
  };

  const handleReplaceCurrent = (replacement: string) => {
    if (totalMatches === 0 || isTrash || mode !== 'write') return;
    if (activeTitleMatchIndex >= 0 && titleMatches[activeTitleMatchIndex]) {
      const res = replaceMatches(title, titleMatches, replacement, activeTitleMatchIndex);
      setTitle(res.value);
      setTouched(true);
      return;
    }
    if (activeBodyMatchIndex >= 0 && bodyMatches[activeBodyMatchIndex]) {
      const res = replaceMatches(body, bodyMatches, replacement, activeBodyMatchIndex);
      applyBody(res.value, res.caret, res.caret, false);
    }
  };

  const handleReplaceAll = (replacement: string) => {
    if (totalMatches === 0 || isTrash || mode !== 'write') return;
    const count = totalMatches;
    if (titleMatches.length > 0) {
      const resTitle = replaceMatches(title, titleMatches, replacement);
      setTitle(resTitle.value);
      setTouched(true);
    }
    if (bodyMatches.length > 0) {
      const resBody = replaceMatches(body, bodyMatches, replacement);
      applyBody(resBody.value, resBody.caret, resBody.caret, false);
    }
    toast(`${count.toLocaleString('fa-IR')} مورد جایگزین شد`);
  };

  const toggleSearchFromToolbar = () => {
    if (searchOpen) {
      closeSearch();
    } else {
      setSearchInstant(false);
      setSearchOpen(true);
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    }
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
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col items-end gap-2 sm:inset-x-5">
        <div className="pointer-events-auto">
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
            searchOpen={searchOpen}
            onToggleSearch={toggleSearchFromToolbar}
          />
        </div>

        <AnimatePresence>
          {searchOpen && (
            <div className="pointer-events-auto w-full max-w-md">
              <EditorSearchBar
                query={searchQuery}
                onQueryChange={q => {
                  setSearchQuery(q);
                  setActiveMatchIndex(0);
                }}
                matchCount={totalMatches}
                activeIndex={clampedMatchIndex}
                caseSensitive={caseSensitive}
                onToggleCaseSensitive={() => {
                  setCaseSensitive(c => !c);
                  setActiveMatchIndex(0);
                }}
                wholeWord={wholeWord}
                onToggleWholeWord={() => {
                  setWholeWord(w => !w);
                  setActiveMatchIndex(0);
                }}
                onNext={() => {
                  if (totalMatches > 0) setActiveMatchIndex(i => (i + 1) % totalMatches);
                }}
                onPrev={() => {
                  if (totalMatches > 0) setActiveMatchIndex(i => (i - 1 + totalMatches) % totalMatches);
                }}
                canReplace={!isTrash && mode === 'write'}
                onReplaceCurrent={handleReplaceCurrent}
                onReplaceAll={handleReplaceAll}
                onClose={closeSearch}
                instant={searchInstant}
                inputRef={searchInputRef}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* One scroll container for the whole document — title included, because a
          title is part of the page, not a form field pinned above it. */}
      <div
        onMouseDown={focusBody}
        className={`editor-scroller min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-10 ${searchOpen ? 'pt-32' : 'pt-18'}`}
      >
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
        <div className="relative grid w-full [&>*]:[grid-area:1/1]">
          {hasActiveQuery && titleMatches.length > 0 && (
            <div
              aria-hidden="true"
              dir={titleDir}
              className={`pointer-events-none w-full select-none overflow-hidden whitespace-pre pb-1 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-transparent ${gutter}`}
            >
              {renderBackdropHighlights(title, titleMatches, activeTitleMatchIndex)}
            </div>
          )}
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={e => { setTitle(e.target.value); setTouched(true); }}
            placeholder="عنوان"
            aria-label="عنوان یادداشت"
            dir={titleDir}
            disabled={isTrash}
            className={`w-full border-none bg-transparent pb-1 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-ink outline-none placeholder:text-muted disabled:opacity-60 ${gutter}`}
          />
        </div>

        {mode === 'preview' && (
          <div
            ref={previewRef}
            className={`markdown-preview py-3 ${gutter}`}
            dir={note.dir === 'ltr' ? 'ltr' : 'rtl'}
            dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
          />
        )}

        <Suspense fallback={<div className={`py-3 ${gutter}`} />}>
          <div className={`py-3 ${gutter}`} hidden={mode === 'preview'}>
            <CodeEditor
              ref={cmRef}
              noteId={note.id}
              value={body}
              onChange={v => { setBody(v); setTouched(true); }}
              dir={note.dir}
              multiCursor={settings.experimentalEditor}
              disabled={isTrash}
              hidden={mode === 'preview'}
              searchMatches={bodyMatches}
              activeSearchIndex={activeBodyMatchIndex}
              onSelectionChange={setHasSelection}
              onRequestMenu={(x, y, keyboard) => {
                const selection = cmRef.current?.selection();
                if (selection) setMenu({ x, y, keyboard, ...selection });
              }}
            />
          </div>
        </Suspense>

        {/* Absent, not disabled, without a pro token — the app is simply the app it was
            before attachments existed. PRODUCT.md principle 1. */}
        {token && tier === 'pro' && (
          <div className={gutter}>
            <Attachments
              noteId={note.id}
              token={token}
              attachments={attachments}
              onAdded={onAttachmentAdded}
              onRemoved={onAttachmentRemoved}
              readOnly={isTrash}
            />
          </div>
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
          aiEnabled={aiEnabled}
          onAi={task => setAi({
            x: menu.x, y: menu.y, task,
            text: menu.value.slice(menu.from, menu.to),
            from: menu.from, to: menu.to,
          })}
          autoFocus={menu.keyboard}
          onMove={groupId => onSetGroup(note.id, groupId)}
          onClose={() => { setMenu(null); cmRef.current?.focus(); }}
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
            const at = cmRef.current?.selection().from ?? body.length;
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
