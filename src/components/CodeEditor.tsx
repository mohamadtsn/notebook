import { useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
import { EditorState } from '@codemirror/state';
import {
  EditorView, keymap, drawSelection, rectangularSelection, placeholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyField, historyKeymap } from '@codemirror/commands';
import { loadCmHistory, saveCmHistory, type CmSnapshot } from '../utils/cmHistory';

/** The serialised fields, named once so save and restore cannot drift apart. */
const PERSISTED_FIELDS = { history: historyField };
/** Writes are batched: serialising the whole undo stack per keystroke is pure waste. */
const FLUSH_MS = 1000;

export interface CodeEditorHandle {
  /** Focus and put a single caret at the end — the click-to-write contract. */
  focusEnd(): void;
  /** What the context menu operates on, read at the moment the menu opens. */
  selection(): { value: string; from: number; to: number };
  select(from: number, to: number): void;
}

interface CodeEditorProps {
  /** Keys the persisted undo stack. The component remounts when this changes. */
  noteId: string;
  value: string;
  onChange: (v: string) => void;
  dir: 'rtl' | 'ltr';
  disabled: boolean;
  /** Kept mounted while the preview is up — see the comment on the effect below. */
  hidden: boolean;
  onRequestMenu: (x: number, y: number, keyboard: boolean) => void;
  ref?: RefObject<CodeEditorHandle | null>;
}

/**
 * The body field when `settings.experimentalEditor` is on. A `<textarea>` cannot place a
 * second caret at all, which is the entire reason this component exists.
 *
 * **Undo here is CodeMirror's, not ours.** `utils/history.ts` stores one `{value, start, end}`
 * per step and cannot represent a multi-range edit, so running both stacks would let them
 * diverge — the exact bug the interception in Editor.tsx exists to prevent.
 *
 * It is persisted all the same, in `utils/cmHistory.ts`: the whole editor remounts on a note
 * switch (`key={id}` in App), so an undo stack that lives in the view dies exactly when the
 * user comes back to a note. CodeMirror serialises its own stack through `historyField`, so
 * what is stored is the editor's real history, not a re-derivation of it.
 */
export function CodeEditor({
  noteId, value, onChange, dir, disabled, hidden, onRequestMenu, ref,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Read through refs so the view is built once: recreating it per keystroke would
  // throw away the selection and the undo stack.
  const onChangeRef = useRef(onChange);
  const onMenuRef = useRef(onRequestMenu);
  useEffect(() => { onChangeRef.current = onChange; onMenuRef.current = onRequestMenu; });

  useImperativeHandle(ref, () => ({
    focusEnd() {
      const view = viewRef.current;
      if (!view) return;
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    },
    selection() {
      const view = viewRef.current;
      if (!view) return { value: '', from: 0, to: 0 };
      const r = view.state.selection.main;
      return { value: view.state.doc.toString(), from: r.from, to: r.to };
    },
    select(from, to) {
      const view = viewRef.current;
      if (!view) return;
      view.focus();
      view.dispatch({ selection: { anchor: from, head: to } });
    },
  }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      const view = viewRef.current;
      if (view) saveCmHistory(noteId, view.state.toJSON(PERSISTED_FIELDS) as CmSnapshot);
    };
    const scheduleFlush = () => { flushTimer ??= setTimeout(flush, FLUSH_MS); };
    // The tab can go away mid-edit; a pending flush must not go with it.
    const onHide = () => { if (flushTimer !== null) { clearTimeout(flushTimer); flush(); } };

    /**
     * Shift passes through to the browser's own menu — Persian spellcheck lives there
     * (DESIGN.md §6). Same guard as the textarea path.
     */
    const onContextMenu = (e: MouseEvent) => {
      if (e.shiftKey || disabled) return;
      e.preventDefault();
      onMenuRef.current(e.clientX, e.clientY, false);
    };

    const extensions = [
      EditorState.allowMultipleSelections.of(true),
      // Native selection rendering can only draw one range.
      drawSelection(),
      // Alt+click adds a caret (VS Code's binding, and what the settings row
      // promises); CodeMirror's own default of Ctrl/Cmd+click is kept alongside.
      EditorView.clickAddsSelectionRange.of(e => e.altKey || e.ctrlKey || e.metaKey),
      // Column select moves to Shift+Alt+drag, because plain Alt+drag is now the
      // drag half of Alt+click and the two cannot share the modifier.
      rectangularSelection({ eventFilter: e => e.altKey && e.shiftKey }),
      history(),
      keymap.of([
        // Shift+F10 / the Menu key: a menu reachable only by right-click is not a
        // keyboard path (DESIGN.md §8).
        {
          key: 'Shift-F10',
          run: v => {
            const r = v.dom.getBoundingClientRect();
            onMenuRef.current(r.left + 24, r.top + 24, true);
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.lineWrapping,
      placeholder('شروع کنید به نوشتن...'),
      // The host div is not the labelled element — the contenteditable is.
      EditorView.contentAttributes.of({ 'aria-label': 'متن یادداشت' }),
      EditorState.readOnly.of(disabled),
      EditorView.editable.of(!disabled),
      EditorView.updateListener.of(u => {
        if (!u.docChanged) return;
        onChangeRef.current(u.state.doc.toString());
        scheduleFlush();
      }),
      // The document is the one scroll container (Editor.tsx). A height or an
      // overflow here would nest a second scrollbar inside it — DESIGN.md §2.
      EditorView.theme({
        '&': { backgroundColor: 'transparent', color: 'var(--ink)' },
        '.cm-content': {
          padding: 0,
          fontFamily: 'inherit',
          fontSize: '1rem',
          lineHeight: '1.8',
          caretColor: 'var(--ink)',
        },
        // The sheet's lit border is the focus indicator (§8); a ring here would be a second one.
        '&.cm-focused': { outline: 'none' },
        '.cm-scroller': { overflow: 'visible', fontFamily: 'inherit', lineHeight: '1.8' },
        '.cm-line': { padding: 0 },
        // `borderLeftColor`, not the logical property, and this is the one place in the
        // app where that is right: CodeMirror draws the caret as a hard-coded
        // `border-left` on both sides of a bidi boundary, so a `border-inline-start`
        // override lands on the *other* edge in RTL and the caret stays base-theme black.
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
        // Two rules, and the second one is spelled out in full on purpose. CodeMirror's
        // base theme styles the focused selection through
        // `&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`,
        // and anything shorter loses to it and leaves the stock grey #d7d4f0 behind the
        // text. (`&light` / `&dark` themselves are baseTheme-only syntax — using them here
        // throws "Unsupported selector" at runtime; a theme states its own colours and
        // takes precedence over the base theme at equal specificity.)
        //
        // Both rules state `--selection`. The unfocused one used to be `--accent-soft`,
        // which is the row-tint token at .12 alpha — behind body text that is close
        // enough to invisible that a selection made and then clicked away from looked
        // like no selection at all. DESIGN.md §1 assigns `--selection` to "selected text,
        // everywhere", and dimming on blur is not a distinction the design system makes.
        '.cm-selectionBackground': { backgroundColor: 'var(--selection)' },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
          backgroundColor: 'var(--selection)',
        },
      }),
    ];

    /**
     * A stored stack is only valid for the document it was recorded against. If the note
     * changed elsewhere — a sync pulled a newer body, another tab edited it — replaying
     * that stack would undo its way into text the user never wrote, so it is dropped.
     */
    const saved = loadCmHistory(noteId);
    const view = new EditorView({
      parent: host,
      state: saved && saved.doc === value
        ? EditorState.fromJSON(saved, { extensions }, PERSISTED_FIELDS)
        : EditorState.create({ doc: value, extensions }),
    });
    viewRef.current = view;
    view.dom.addEventListener('contextmenu', onContextMenu);

    window.addEventListener('pagehide', onHide);

    return () => {
      // Save BEFORE destroying: this cleanup is the note switch, which is the whole
      // reason the stack is persisted at all.
      onHide();
      window.removeEventListener('pagehide', onHide);
      view.dom.removeEventListener('contextmenu', onContextMenu);
      view.destroy();
      viewRef.current = null;
    };
    // Built once per mount. Editor.tsx is keyed on the note id (App.tsx), so a note
    // switch remounts this — which is how the draft state already resets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Outside writes (an AI replacement, a menu action) arrive as a new `value`. Only
  // dispatch on a real difference: echoing every keystroke back would reset the caret.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  // Hidden rather than unmounted for the same reason as the textarea: the undo stack
  // belongs to the editor instance, and the preview toggle must not empty it. Coming
  // back from `display: none` means every cached measurement is stale.
  useEffect(() => {
    if (!hidden) viewRef.current?.requestMeasure();
  }, [hidden]);

  // `dir` sits on the host so `useTextDirection` stays the single source of truth for
  // both fields — CodeMirror reads the direction off the computed style.
  return <div ref={hostRef} dir={dir} hidden={hidden} className="w-full" />;
}
