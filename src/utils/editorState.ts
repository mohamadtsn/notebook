import { EditorSelection, EditorState, type ChangeSet, type Extension } from '@codemirror/state';
import { historyField, isolateHistory, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import type { CmSnapshot } from './cmHistory.ts';
import { MAX_ENTRIES, type HistoryEntry, type NoteHistory } from './history.ts';

export const persistedEditorFields = { history: historyField };

function normalizeNewlines(value: string) {
  return value.replace(/\r\n?/g, '\n');
}

export function editorOffset(source: string, offset: number) {
  if (!source.includes('\r\n')) return offset;
  let position = offset;
  for (const match of source.matchAll(/\r\n/g)) {
    if (match.index + 1 >= offset) break;
    position--;
  }
  return position;
}

export function sourceOffset(source: string, offset: number) {
  if (!source.includes('\r\n')) return offset;
  let position = offset;
  for (const match of source.matchAll(/\r\n/g)) {
    if (match.index >= position) break;
    position++;
  }
  return position;
}

export function sourceLineSeparator(source: string) {
  return /\r\n?|\n/.exec(source)?.[0];
}

export function applyEditorChanges(source: string, changes: ChangeSet, separator: string) {
  if (changes.empty) return source;
  let result = '';
  let cursor = 0;
  changes.iterChanges((from, to, _fromNew, _toNew, inserted) => {
    const start = sourceOffset(source, from);
    const end = sourceOffset(source, to);
    result += source.slice(cursor, start) + inserted.sliceString(0, inserted.length, separator);
    cursor = end;
  });
  return result + source.slice(cursor);
}

export function minimalChange(previous: string, next: string) {
  let from = 0;
  const common = Math.min(previous.length, next.length);
  while (from < common && previous.charCodeAt(from) === next.charCodeAt(from)) from++;
  let to = previous.length;
  let end = next.length;
  while (to > from && end > from && previous.charCodeAt(to - 1) === next.charCodeAt(end - 1)) {
    to--;
    end--;
  }
  return { from, to, insert: next.slice(from, end) };
}

function validOffset(offset: number, length: number) {
  return Number.isInteger(offset) && offset >= 0 && offset <= length;
}

function validSelection(selection: EditorSelection, length: number) {
  return selection.ranges.length > 0 && validOffset(selection.mainIndex, selection.ranges.length - 1)
    && selection.ranges.every(({ anchor, head }) => validOffset(anchor, length) && validOffset(head, length));
}

function validEntry(entry: HistoryEntry) {
  return entry && typeof entry.value === 'string' && entry.start <= entry.end
    && validOffset(entry.start, entry.value.length) && validOffset(entry.end, entry.value.length);
}

function historyIsUsable(state: EditorState) {
  for (const [command, depth] of [[undo, undoDepth], [redo, redoDepth]] as const) {
    let cursor = state;
    // Check the saved operations at the document lengths where they'll be applied.
    // Use an editable state to validate history even when opening a note in Trash.
    for (let i = 0, count = depth(cursor); i < count; i++) {
      if (!command({ state: cursor, dispatch: tr => { cursor = tr.state; } })) return false;
      if (!validSelection(cursor.selection, cursor.doc.length)) return false;
    }
  }
  return true;
}

export function createBodyEditorState(
  value: string,
  extensions: Extension,
  snapshot: CmSnapshot | null,
  legacy: NoteHistory | null,
): EditorState {
  let selection: EditorSelection | undefined;
  if (snapshot?.doc === normalizeNewlines(value) && (snapshot.source ?? value) === value) {
    try {
      const savedSelection = EditorSelection.fromJSON(snapshot.selection);
      if (validSelection(savedSelection, snapshot.doc.length)) selection = savedSelection;
      if (selection && snapshot.history) {
        const state = EditorState.fromJSON(snapshot, { extensions: [historyField, EditorState.allowMultipleSelections.of(true)] }, persistedEditorFields);
        if (historyIsUsable(state)) return EditorState.fromJSON(snapshot, { extensions }, persistedEditorFields);
      }
    } catch {
      // The current body and any valid cursor can still be opened.
    }
  }

  const entries = legacy?.entries;
  const index = legacy?.index ?? -1;
  if (Array.isArray(entries) && entries.length <= MAX_ENTRIES && Number.isInteger(index)
    && entries[index]?.value === value && entries.every(validEntry)) {
    try {
      const first = entries[0];
      const current = entries[index];
      let state = EditorState.create({
        doc: first.value,
        selection: { anchor: editorOffset(first.value, first.start), head: editorOffset(first.value, first.end) },
        extensions: historyField,
      });
      for (const entry of entries.slice(1)) {
        const changes = minimalChange(state.doc.toString(), normalizeNewlines(entry.value));
        if (changes.from === changes.to && !changes.insert) throw new Error('Duplicate history revision');
        state = state.update({
          changes,
          selection: { anchor: editorOffset(entry.value, entry.start), head: editorOffset(entry.value, entry.end) },
          annotations: isolateHistory.of('full'),
        }).state;
      }
      for (let i = entries.length - 1; i > index; i--) {
        if (!undo({ state, dispatch: tr => { state = tr.state; } })) throw new Error('Missing history revision');
      }
      if (state.doc.toString() !== normalizeNewlines(value)) throw new Error('History document mismatch');
      return EditorState.fromJSON({
        ...state.toJSON(persistedEditorFields),
        selection: EditorSelection.single(editorOffset(value, current.start), editorOffset(value, current.end)).toJSON(),
      }, { extensions }, persistedEditorFields);
    } catch {
      // A partial import is unusable.
    }
  }

  return EditorState.create({ doc: value, selection, extensions });
}
