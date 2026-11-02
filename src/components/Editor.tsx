import { lazy, Suspense, useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Undo2 } from 'lucide-react';
import { easeOut } from '../lib/motion';
import type { Note, NoteColor } from '../types/note';
import type { Group } from '../types/group';
import { useDebounce } from '../hooks/useDebounce';
import { useHistory } from '../hooks/useHistory';
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

/**
 * Renders transparent text with `<mark>` backgrounds behind an `<input>` or `<textarea>`
 * sharing the same grid cell, so all search matches remain visible even while focus is
 * inside the search bar (where native blurred textarea selection disappears in Chrome).
 */
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
  // Trailing newline preservation for multi-line textarea height parity
  if (text.endsWith('\n')) {
    parts.push('\n');
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
  const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<EditorMode>('write');
  // The selection is captured when the menu opens, not read later: the textarea loses
  // it the moment a menu item takes focus.
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

  const openMenuAt = (x: number, y: number, el: HTMLTextAreaElement, keyboard = false) => setMenu({
    x, y, keyboard,
    value: el.value,
    from: Math.min(el.selectionStart, el.selectionEnd),
    to: Math.max(el.selectionStart, el.selectionEnd),
  });
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cmRef = useRef<CodeEditorHandle | null>(null);
  const advanced = settings.experimentalEditor;
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
      requestAnimationFrame(() => {
        if (advanced) {
          cmRef.current?.select(m.from, m.to);
        } else {
          bodyRef.current?.focus();
          bodyRef.current?.setSelectionRange(m.from, m.to);
        }
      });
    }
  }, [mode, isTrash, activeTitleMatchIndex, titleMatches, activeBodyMatchIndex, bodyMatches, advanced]);

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
        const sel = advanced
          ? cmRef.current?.selection()
          : bodyRef.current && {
              value: bodyRef.current.value,
              from: bodyRef.current.selectionStart,
              to: bodyRef.current.selectionEnd,
            };
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
          || active === bodyRef.current
          || (active instanceof HTMLElement && active.isContentEditable);
        if (!inEditorField) {
          e.preventDefault();
          closeSearch();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [advanced, searchOpen, closeSearch]);

  // Sync search highlights to CodeMirror when experimental editor is active
  useEffect(() => {
    if (!advanced) return;
    cmRef.current?.setSearchHighlights(
      hasActiveQuery ? bodyMatches : [],
      activeBodyMatchIndex,
    );
  }, [advanced, hasActiveQuery, bodyMatches, activeBodyMatchIndex, mode]);

  // Scroll active match into view in plain textarea or title mode
  useEffect(() => {
    if (!hasActiveQuery) return;
    if (activeTitleMatchIndex >= 0) {
      titleRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
      return;
    }
    if (mode === 'write' && !advanced && activeBodyMatchIndex >= 0) {
      const mark = backdropRef.current?.querySelector<HTMLElement>('[data-active-match="true"]');
      mark?.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }, [hasActiveQuery, activeTitleMatchIndex, activeBodyMatchIndex, mode, advanced, bodyMatches]);

  const renderedMarkdown = useMemo(() => renderMarkdown(body), [body]);

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

  // In an RTL `<textarea>`, a line ending with an LTR run (e.g. "… حتی space" with no
  // trailing character) renders the LTR characters left-to-right (`s-p-a-c-e`) at the
  // left end of the RTL line, so `'e'` (`lineEnd - 1`) sits on the right and `'s'`
  // (`ltrStart`) sits on the left. As the user drags from the RTL portion of the line
  // (`anchor < ltrStart`) leftward across the English word, the browser hit-tests `'e'`
  // (`lineEnd - 1`) first and counts backwards down to `'s'` (`ltrStart`), un-selecting
  // the English word as the pointer reaches its visual left edge. Mirroring the offset
  // within `[ltrStart, lineEnd]` while dragging leftward makes selection grow smoothly.
  useEffect(() => {
    if (advanced || bodyDir !== 'rtl') return;
    const el = bodyRef.current;
    if (!el) return;

    let drag: {
      anchor: number;
      entryX: number | null;
      sawInside: boolean;
      lastX: number;
    } | null = null;

    const findTrailingLtrStart = (val: string, lineStart: number, lineEnd: number): number => {
      let i = lineEnd;
      let hasLatin = false;
      while (i > lineStart) {
        const ch = val[i - 1];
        if (/[A-Za-z0-9_./:@#+-]/.test(ch)) {
          if (/[A-Za-z]/.test(ch)) hasLatin = true;
          i--;
        } else {
          break;
        }
      }
      return hasLatin && i > lineStart && i < lineEnd ? i : -1;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      requestAnimationFrame(() => {
        drag = {
          anchor: el.selectionDirection === 'backward' ? el.selectionEnd : el.selectionStart,
          entryX: null,
          sawInside: false,
          lastX: startX,
        };
      });
    };

    const adjustSelection = (clientX: number) => {
      if (!drag) return;
      const val = el.value;
      const { anchor } = drag;
      const rawEnd = el.selectionEnd;
      if (el.selectionStart !== anchor || rawEnd <= anchor) return;

      let lineStart = val.lastIndexOf('\n', rawEnd - 1);
      lineStart = lineStart === -1 ? 0 : lineStart + 1;
      let lineEnd = val.indexOf('\n', rawEnd);
      if (lineEnd === -1) lineEnd = val.length;

      const ltrStart = findTrailingLtrStart(val, lineStart, lineEnd);
      if (ltrStart === -1 || anchor >= ltrStart) return;

      if (rawEnd >= ltrStart && rawEnd <= lineEnd) {
        if (drag.entryX === null || clientX > drag.entryX) {
          drag.entryX = clientX;
        }
        if (rawEnd > ltrStart && rawEnd < lineEnd) {
          drag.sawInside = true;
        }
      }

      if (drag.entryX !== null && clientX <= drag.entryX && rawEnd >= ltrStart && rawEnd < lineEnd) {
        if (rawEnd > ltrStart || drag.sawInside || drag.entryX - clientX > 8) {
          const corrected = lineEnd - (rawEnd - ltrStart);
          el.setSelectionRange(anchor, corrected, 'forward');
        }
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!drag || !(e.buttons & 1)) return;
      drag.lastX = e.clientX;
      const x = e.clientX;
      requestAnimationFrame(() => adjustSelection(x));
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!drag) return;
      const x = e.clientX;
      requestAnimationFrame(() => {
        adjustSelection(x);
        drag = null;
      });
    };

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [advanced, bodyDir]);

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
    const scroller = el.closest('.editor-scroller');
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
    if (mod && !e.altKey && isShortcutKey(e.nativeEvent, 'KeyZ', 'z', 'ظ', 'ك')) {
      e.preventDefault();
      applyStep(e.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (mod && !e.altKey && isShortcutKey(e.nativeEvent, 'KeyY', 'y', 'غ', '؛')) {
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
   * The single write path for programmatic edits (menu actions, AI replacement, search
   * replace). It goes through the ordinary draft state, so the 500ms debounce, the `dirty`
   * stamp and the save indicator all behave as if the user had typed it — and it is
   * recorded in the history, so it is undoable like any other edit.
   */
  const applyBody = (value: string, start: number, end: number, focusEditor = true) => {
    setBody(value);
    setTouched(true);
    // `discrete`: a menu/replace action is one deliberate act, so it gets its own undo step
    // instead of merging into whatever was typed a moment earlier.
    history.push({ value, start, end }, true);
    if (!focusEditor) return;
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
            dir={bodyDir}
            dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
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
          <div
            hidden={mode === 'preview'}
            className={mode === 'preview' ? 'hidden' : 'relative grid w-full [&>*]:[grid-area:1/1]'}
          >
            {hasActiveQuery && bodyMatches.length > 0 && (
              <div
                ref={backdropRef}
                aria-hidden="true"
                dir={bodyDir}
                className={`pointer-events-none w-full select-none overflow-hidden whitespace-pre-wrap break-words border-none bg-transparent py-3 text-base leading-[1.8] text-transparent ${gutter}`}
              >
                {renderBackdropHighlights(body, bodyMatches, activeBodyMatchIndex)}
              </div>
            )}
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
          </div>
        )}

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
