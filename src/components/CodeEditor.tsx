import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type RefObject } from 'react';
import { Annotation, Compartment, EditorState, Facet, Prec, RangeSetBuilder, StateEffect, StateField, Transaction, type Range } from '@codemirror/state';
import {
  Decoration, Direction, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate,
  keymap, drawSelection, rectangularSelection, placeholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, isolateHistory, redo, undo } from '@codemirror/commands';
import { isCoarsePointer } from '../utils/device';
import { dropCmHistory, loadCmHistory, saveCmHistory, type CmSnapshot } from '../utils/cmHistory';
import { dropHistory, loadLegacyHistory } from '../hooks/useHistory';
import { isShortcutKey, type MatchRange } from '../utils/search';
import type { NoteDir } from '../types/note';
import { analyzeMarkdown } from '../utils/markdownDirection';
import {
  applyEditorChanges, createBodyEditorState, editorOffset, minimalChange, persistedEditorFields,
  sourceLineSeparator, sourceOffset,
} from '../utils/editorState';

/** Writes are batched: serialising the whole undo stack per keystroke is pure waste. */
const FLUSH_MS = 1000;

const direction = new Compartment();
const multipleSelections = new Compartment();
const readOnly = new Compartment();
const historyConfig = new Compartment();
const externalValue = Annotation.define<string>();
const replacementValue = Annotation.define<string>();
const multiCursorExtensions = [
  EditorState.allowMultipleSelections.of(true),
  EditorView.clickAddsSelectionRange.of(e => e.altKey || e.ctrlKey || e.metaKey),
  rectangularSelection({ eventFilter: e => e.altKey && e.shiftKey }),
];
const editingMode = (disabled: boolean) => [
  EditorState.readOnly.of(disabled),
  EditorView.editable.of(!disabled),
];
const directionMode = Facet.define<NoteDir, NoteDir>({ combine: values => values[0] ?? 'auto' });
const directionLines = {
  rtl: Decoration.line({ attributes: { dir: 'rtl' } }),
  ltr: Decoration.line({ attributes: { dir: 'ltr' } }),
};
const ltrIsolate = Decoration.mark({
  class: 'cm-bidi-isolate',
  attributes: { dir: 'ltr' },
  bidiIsolate: Direction.LTR,
});

const lineDirections = ViewPlugin.fromClass(class {
  private analysis: ReturnType<typeof analyzeMarkdown>;
  decorations: DecorationSet;
  isolates: DecorationSet;

  constructor(view: EditorView) {
    this.analysis = analyzeMarkdown(view.state.doc.toString(), view.state.facet(directionMode));
    [this.decorations, this.isolates] = this.visibleDecorations(view);
  }

  update(update: ViewUpdate) {
    const mode = update.state.facet(directionMode);
    const changed = update.docChanged || mode !== update.startState.facet(directionMode);
    if (changed) this.analysis = analyzeMarkdown(update.state.doc.toString(), mode);
    if (changed || update.viewportChanged) {
      [this.decorations, this.isolates] = this.visibleDecorations(update.view);
    }
  }

  private visibleDecorations(view: EditorView): [DecorationSet, DecorationSet] {
    const lines: Range<Decoration>[] = [];
    const marks: Range<Decoration>[] = [];
    const { doc } = view.state;
    let decoratedThrough = 0;
    for (const { from, to } of view.visibleRanges) {
      let line = doc.lineAt(from);
      while (line.from <= to) {
        if (line.number > decoratedThrough) {
          const index = line.number - 1;
          lines.push(directionLines[this.analysis.directions[index]].range(line.from));
          for (const { from: start, to: end } of this.analysis.isolates[index]) {
            if (end > start) marks.push(ltrIsolate.range(line.from + start, line.from + end));
          }
          decoratedThrough = line.number;
        }
        if (line.number === doc.lines) break;
        line = doc.line(line.number + 1);
      }
    }
    return [Decoration.set([...lines, ...marks], true), Decoration.set(marks)];
  }
}, {
  decorations: plugin => plugin.decorations,
  provide: plugin => EditorView.bidiIsolatedRanges.of(view => view.plugin(plugin)?.isolates ?? Decoration.none),
});

const setSearchEffect = StateEffect.define<{ matches: MatchRange[]; activeIndex: number }>();
const searchMark = Decoration.mark({ class: 'cm-searchMatch' });
const activeSearchMark = Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' });

const searchHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setSearchEffect)) {
        const builder = new RangeSetBuilder<Decoration>();
        const docLen = tr.state.doc.length;
        e.value.matches.forEach((m, i) => {
          const from = Math.max(0, Math.min(docLen, m.from));
          const to = Math.max(from, Math.min(docLen, m.to));
          if (to > from) {
            builder.add(from, to, i === e.value.activeIndex ? activeSearchMark : searchMark);
          }
        });
        deco = builder.finish();
      }
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

export interface CodeEditorHandle {
  /** Focus and put a single caret at the end — the click-to-write contract. */
  focusEnd(): void;
  focus(): void;
  /** What the context menu operates on, read at the moment the menu opens. */
  selection(): { value: string; from: number; to: number };
  select(from: number, to: number): void;
  replaceValue(value: string, from: number, to: number, focus: boolean): void;
}

interface CodeEditorProps {
  /** Keys the persisted undo stack. The component remounts when this changes. */
  noteId: string;
  value: string;
  onChange: (v: string) => void;
  dir: NoteDir;
  multiCursor: boolean;
  disabled: boolean;
  /** Kept mounted while the preview is up — see the comment on the effect below. */
  hidden: boolean;
  searchMatches: MatchRange[];
  activeSearchIndex: number;
  onRequestMenu: (x: number, y: number, keyboard: boolean) => void;
  onSelectionChange: (hasSelection: boolean) => void;
  ref?: RefObject<CodeEditorHandle | null>;
}

export function CodeEditor({
  noteId, value, onChange, dir, multiCursor, disabled, hidden, searchMatches, activeSearchIndex,
  onRequestMenu, onSelectionChange, ref,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sourceRef = useRef(value);
  const lineSeparator = useRef(sourceLineSeparator(value) ?? '\n');
  // Read through refs so the view is built once: recreating it per keystroke would
  // throw away the selection and the undo stack.
  const onChangeRef = useRef(onChange);
  const onMenuRef = useRef(onRequestMenu);
  const onSelectionRef = useRef(onSelectionChange);
  useEffect(() => {
    onChangeRef.current = onChange;
    onMenuRef.current = onRequestMenu;
    onSelectionRef.current = onSelectionChange;
  });

  useImperativeHandle(ref, () => ({
    focusEnd() {
      const view = viewRef.current;
      if (!view) return;
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    },
    focus() {
      viewRef.current?.focus();
    },
    selection() {
      const view = viewRef.current;
      if (!view) return { value: '', from: 0, to: 0 };
      const r = view.state.selection.main;
      const source = sourceRef.current;
      return { value: source, from: sourceOffset(source, r.from), to: sourceOffset(source, r.to) };
    },
    select(from, to) {
      const view = viewRef.current;
      if (!view) return;
      const length = view.state.doc.length;
      view.focus();
      view.dispatch({ selection: {
        anchor: Math.min(editorOffset(sourceRef.current, from), length),
        head: Math.min(editorOffset(sourceRef.current, to), length),
      } });
    },
    replaceValue(next, from, to, focus) {
      const view = viewRef.current;
      if (!view || view.state.readOnly) return;
      const previous = view.state.doc.toString();
      const normalized = view.state.toText(next);
      const changes = minimalChange(previous, normalized.toString());
      view.dispatch({
        changes,
        selection: {
          anchor: Math.min(editorOffset(next, from), normalized.length),
          head: Math.min(editorOffset(next, to), normalized.length),
        },
        annotations: [replacementValue.of(next), isolateHistory.of('full'), Transaction.userEvent.of('input')],
        scrollIntoView: focus,
      });
      if (focus) view.focus();
    },
  }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      const view = viewRef.current;
      if (view) {
        const snapshot = view.state.toJSON(persistedEditorFields) as CmSnapshot;
        if (snapshot.doc !== sourceRef.current) snapshot.source = sourceRef.current;
        if (lineSeparator.current !== '\n') snapshot.lineSeparator = lineSeparator.current;
        saveCmHistory(noteId, snapshot);
      }
    };
    const scheduleFlush = () => { flushTimer ??= setTimeout(flush, FLUSH_MS); };
    // The tab can go away mid-edit; a pending flush must not go with it.
    const onHide = () => { if (flushTimer !== null) { clearTimeout(flushTimer); flush(); } };

    const requestMenu = (view: EditorView) => {
      if (view.state.readOnly) return false;
      const r = view.dom.getBoundingClientRect();
      onMenuRef.current(r.left + 24, r.top + 24, true);
      return true;
    };

    // Leave the browser's spellcheck menu and touch selection handles available.
    const onContextMenu = (e: MouseEvent) => {
      if (isCoarsePointer() || e.shiftKey || viewRef.current?.state.readOnly) return;
      e.preventDefault();
      onMenuRef.current(e.clientX, e.clientY, false);
    };

    const extensions = [
      direction.of(directionMode.of(dir)),
      EditorView.perLineTextDirection.of(true),
      lineDirections,
      multipleSelections.of(multiCursor ? multiCursorExtensions : []),
      drawSelection(),
      searchHighlightField,
      historyConfig.of(history()),
      keymap.of([
        { key: 'Shift-F10', run: requestMenu },
        { key: 'ContextMenu', run: requestMenu },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      Prec.high(EditorView.domEventHandlers({
        keydown(event, view) {
          if (view.state.readOnly || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return false;
          if (isShortcutKey(event, 'KeyZ', 'z', 'ظ', 'ك')) {
            (event.shiftKey ? redo : undo)(view);
            return true;
          }
          if (isShortcutKey(event, 'KeyY', 'y', 'غ', '؛')) {
            redo(view);
            return true;
          }
          return false;
        },
      })),
      EditorView.lineWrapping,
      placeholder('شروع کنید به نوشتن...'),
      // The host div is not the labelled element — the contenteditable is.
      EditorView.contentAttributes.of({ 'aria-label': 'متن یادداشت' }),
      readOnly.of(editingMode(disabled)),
      EditorView.updateListener.of(u => {
        if (u.selectionSet || u.docChanged) {
          onSelectionRef.current(!u.state.selection.main.empty);
        }
        const external = u.transactions.find(tr => tr.annotation(externalValue) !== undefined)?.annotation(externalValue);
        if (external !== undefined) {
          sourceRef.current = external;
          lineSeparator.current = sourceLineSeparator(external) ?? '\n';
          if (flushTimer !== null) clearTimeout(flushTimer);
          flushTimer = null;
          dropCmHistory(noteId);
          dropHistory(noteId);
        } else if (!u.state.readOnly && (u.docChanged || u.selectionSet)) {
          const source = sourceRef.current;
          for (const tr of u.transactions) {
            sourceRef.current = tr.annotation(replacementValue)
              ?? applyEditorChanges(sourceRef.current, tr.changes, lineSeparator.current);
          }
          if (source !== sourceRef.current) onChangeRef.current(sourceRef.current);
          scheduleFlush();
        }
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
        '.cm-selectionBackground': { backgroundColor: 'var(--selection)' },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
          backgroundColor: 'var(--selection)',
        },
        // In-note search highlights — DESIGN.md §6
        '.cm-searchMatch': {
          backgroundColor: 'var(--accent-soft)',
          borderRadius: '2px',
        },
        '.cm-searchMatch-selected': {
          backgroundColor: 'var(--selection)',
          outline: '1px solid var(--accent)',
          borderRadius: '2px',
        },
      }),
    ];

    const saved = loadCmHistory(noteId);
    if (saved && (saved.source ?? saved.doc) === value && (saved.lineSeparator === '\r\n' || saved.lineSeparator === '\r')) {
      lineSeparator.current = saved.lineSeparator;
    }
    const view = new EditorView({
      parent: host,
      state: createBodyEditorState(value, extensions, saved, loadLegacyHistory(noteId)),
    });
    viewRef.current = view;
    onSelectionRef.current(!view.state.selection.main.empty);

    // Fix Bidi mouse hit-testing when an RTL line contains or ends with an LTR run
    // (e.g. "… حتی space" with no trailing character). In CodeMirror's `InlineCoordsScan`,
    // the leftmost glyph of a trailing LTR run is `spanStart` ('s'), which has `Direction.LTR`;
    // when the pointer is at or to the left of 's', CodeMirror tests `x < mid('s')` against
    // LTR and returns `spanStart` (before the English word) instead of `spanEnd` (end of line).
    let dragAnchorPos: number | null = null;
    const origPosAndSide = view.posAndSideAtCoords.bind(view) as (
      coords: { x: number; y: number },
      precise?: boolean,
    ) => { pos: number; assoc: -1 | 1 } | null;

    const resolveBidiPos = (
      coords: { x: number; y: number },
      raw: { pos: number; assoc: -1 | 1 } | null,
      anchor: number | null,
    ): { pos: number; assoc: -1 | 1 } | null => {
      if (!raw) return null;
      const line = view.state.doc.lineAt(raw.pos);
      if (view.textDirectionAt(line.from) !== Direction.RTL) return raw;

      // The correction mirrors a run only during a drag within that same line.
      const localAnchor = anchor !== null && anchor >= line.from && anchor <= line.to ? anchor : null;
      const spans = view.bidiSpans(line);
      if (spans.length === 0) return raw;

      // 1. Check if the line ends with an LTR span and the pointer is to the left of it
      const lastSpan = spans[spans.length - 1];
      if (lastSpan.dir === Direction.LTR && lastSpan.to === line.length) {
        const spanStart = line.from + lastSpan.from;
        const spanEnd = line.from + lastSpan.to;
        if (raw.pos >= spanStart && raw.pos <= spanEnd) {
          const leftRect = view.coordsAtPos(spanStart, 1);
          const rightRect = view.coordsAtPos(spanEnd, -1);
          if (leftRect && rightRect) {
            const top = Math.min(leftRect.top, rightRect.top) - 6;
            const bottom = Math.max(leftRect.bottom, rightRect.bottom) + 6;
            if (coords.y >= top && coords.y <= bottom) {
              if (coords.x <= leftRect.left + 2) {
                return { pos: spanEnd, assoc: -1 };
              }
              if (localAnchor !== null && localAnchor < spanStart && coords.x <= rightRect.right) {
                const mirrored = spanEnd - (raw.pos - spanStart);
                return { pos: mirrored, assoc: mirrored === spanEnd ? -1 : 1 };
              }
            }
          }
        }
      }

      // 2. When dragging right-to-left from before any inline LTR span, mirror offsets
      //    inside that LTR span's bounding box so the selection grows monotonically.
      if (localAnchor !== null) {
        for (const span of spans) {
          if (span.dir !== Direction.LTR) continue;
          const spanStart = line.from + span.from;
          const spanEnd = line.from + span.to;
          if (localAnchor < spanStart && raw.pos >= spanStart && raw.pos <= spanEnd) {
            const leftRect = view.coordsAtPos(spanStart, 1);
            const rightRect = view.coordsAtPos(spanEnd, -1);
            if (leftRect && rightRect) {
              const top = Math.min(leftRect.top, rightRect.top) - 6;
              const bottom = Math.max(leftRect.bottom, rightRect.bottom) + 6;
              if (
                coords.y >= top
                && coords.y <= bottom
                && coords.x >= leftRect.left
                && coords.x <= rightRect.right
              ) {
                const mirrored = spanEnd - (raw.pos - spanStart);
                return { pos: mirrored, assoc: mirrored === spanEnd ? -1 : 1 };
              }
            }
          }
        }
      }

      return raw;
    };

    view.posAndSideAtCoords = ((coords: { x: number; y: number }, precise?: boolean) => {
      const raw = origPosAndSide(coords, precise);
      return resolveBidiPos(coords, raw, dragAnchorPos);
    }) as typeof view.posAndSideAtCoords;

    view.posAtCoords = ((coords: { x: number; y: number }, precise?: boolean) => {
      const res = resolveBidiPos(coords, origPosAndSide(coords, precise), dragAnchorPos);
      return res ? res.pos : null;
    }) as typeof view.posAtCoords;

    const onMouseDownCapture = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragAnchorPos = null;
      const raw = origPosAndSide({ x: e.clientX, y: e.clientY }, false);
      const resolved = resolveBidiPos({ x: e.clientX, y: e.clientY }, raw, null);
      dragAnchorPos = resolved ? resolved.pos : null;
    };
    const onMouseUpWindow = () => {
      dragAnchorPos = null;
    };

    view.dom.addEventListener('mousedown', onMouseDownCapture, true);
    window.addEventListener('mouseup', onMouseUpWindow, true);
    view.dom.addEventListener('contextmenu', onContextMenu);

    window.addEventListener('pagehide', onHide);

    return () => {
      // Save BEFORE destroying: this cleanup is the note switch, which is the whole
      // reason the stack is persisted at all.
      onHide();
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('mouseup', onMouseUpWindow, true);
      view.dom.removeEventListener('mousedown', onMouseDownCapture, true);
      view.dom.removeEventListener('contextmenu', onContextMenu);
      view.destroy();
      viewRef.current = null;
    };
    // Built once per mount. Editor.tsx is keyed on the note id (App.tsx), so a note
    // switch remounts this — which is how the draft state already resets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || sourceRef.current === value) return;
    const changes = minimalChange(view.state.doc.toString(), view.state.toText(value).toString());
    view.dispatch({ effects: historyConfig.reconfigure([]) });
    view.dispatch({
      changes,
      effects: historyConfig.reconfigure(history()),
      annotations: [externalValue.of(value), Transaction.addToHistory.of(false)],
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [multipleSelections.reconfigure(multiCursor ? multiCursorExtensions : []), readOnly.reconfigure(editingMode(disabled))],
      selection: !multiCursor && view.state.selection.ranges.length > 1
        ? view.state.selection.asSingle()
        : undefined,
    });
  }, [multiCursor, disabled]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || hidden) return;
    const source = sourceRef.current;
    const matches = searchMatches.map(({ from, to }) => ({
      from: editorOffset(source, from),
      to: editorOffset(source, to),
    }));
    const effects: StateEffect<unknown>[] = [setSearchEffect.of({ matches, activeIndex: activeSearchIndex })];
    const match = matches[activeSearchIndex];
    if (match) effects.push(EditorView.scrollIntoView(Math.min(match.from, view.state.doc.length), { y: 'center' }));
    view.dispatch({ effects });
    view.requestMeasure();
  }, [searchMatches, activeSearchIndex, hidden]);

  useLayoutEffect(() => {
    viewRef.current?.dispatch({ effects: direction.reconfigure(directionMode.of(dir)) });
  }, [dir]);

  return <div ref={hostRef} dir="rtl" className={disabled ? 'w-full opacity-60' : 'w-full'} />;
}
