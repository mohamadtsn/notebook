import type { Token } from 'markdown-it';
import type { NoteDir } from '../types/note.ts';
import { inlineSourceRange, markdownParser } from './markdownParser.ts';

export type TextDirection = Exclude<NoteDir, 'auto'>;
type Range = { from: number; to: number };

const arabic = /(?=\p{Script=Arabic})\p{Letter}/u;
const word = /\p{Letter}/u;

export function classifyProse(text: string): TextDirection | null {
  if (arabic.test(text)) return 'rtl';
  return word.test(text) ? 'ltr' : null;
}

export function isAutomaticLink(token: Token): boolean {
  return token.type === 'link_open' && token.info === 'auto';
}

function analyzeInline(
  token: Token,
  startLine: number,
  offsets: number[],
  prose: string[],
  hasIsolatedContent: boolean[],
  isTask: boolean,
  recordIsolate: (line: number, from: number, to: number) => void,
) {
  const lines = token.content.split('\n');
  const untrackedLinks = new Set<number>();
  let localLine = 0;
  let taskPrefix = isTask;
  let skipAutolink = false;
  const advanceTo = (pos: number) => {
    while (localLine + 1 < offsets.length && offsets[localLine + 1] <= pos) localLine++;
  };
  const isolate = (from: number, to: number) => {
    advanceTo(from);
    for (let line = localLine; line < lines.length && offsets[line] < to; line++) {
      recordIsolate(line, Math.max(0, from - offsets[line]), Math.min(lines[line].length, to - offsets[line]));
    }
    advanceTo(to);
  };

  for (const child of token.children ?? []) {
    const range = inlineSourceRange(child);
    if (isAutomaticLink(child)) {
      skipAutolink = true;
      if (range) isolate(range.from, range.to);
      else untrackedLinks.add(localLine);
      continue;
    }
    if (child.type === 'link_close') {
      if (range && offsets[localLine + 1] <= range.to) {
        const first = localLine;
        advanceTo(range.to);
        for (let line = first + 1; line <= localLine; line++) {
          hasIsolatedContent[startLine + line] = true;
          recordIsolate(line, 0, Math.min(lines[line].length, range.to - offsets[line]));
        }
      }
      skipAutolink = false;
      continue;
    }
    if (child.type === 'softbreak' || child.type === 'hardbreak') {
      if (range) advanceTo(range.to);
      else localLine = Math.min(localLine + 1, lines.length - 1);
      taskPrefix = false;
      continue;
    }
    if (skipAutolink) {
      if (child.type === 'text') hasIsolatedContent[startLine + localLine] = true;
      continue;
    }
    if (child.type === 'code_inline' && range) {
      advanceTo(range.from);
      for (let line = localLine; line < lines.length && offsets[line] < range.to; line++) {
        hasIsolatedContent[startLine + line] = true;
      }
      isolate(range.from, range.to);
      continue;
    }
    if (child.type === 'text' && child.content) {
      prose[startLine + localLine] += taskPrefix
        ? child.content.replace(/^\[[ xX]\](?=\s|$)/, '')
        : child.content;
      taskPrefix = false;
    }
  }

  // Linkify's final pass can create link tokens without offsets.
  // Match those against the original inline text, outside recorded code spans.
  for (const line of untrackedLinks) {
    const linkify = markdownParser.linkify;
    if (!linkify.test(lines[line])) continue;
    for (const match of linkify.match(lines[line]) ?? []) {
      recordIsolate(line, match.index, match.lastIndex);
    }
  }
}

export function analyzeMarkdown(source: string, mode: NoteDir) {
  const tokens = markdownParser.parse(source, {});
  const lines = source.split(/\r\n?|\n/);
  const prose = lines.map(() => '');
  const hasIsolatedContent = lines.map(() => false);
  const isolates: Range[][] = lines.map(() => []);
  const code = lines.map(() => false);
  const inlineLines = new Map<Token, number>();
  let row: number | undefined;
  let taskLine: number | undefined;
  let tableColumn = 0;

  for (const token of tokens) {
    if (token.type === 'fence' || token.type === 'code_block') {
      const [from, to] = token.map!;
      code.fill(true, from, to);
      if (token.type === 'fence' && to === lines.length - 1 && lines[to] === ''
        && token.content.split('\n').length === to - from) {
        code[to] = true;
      }
      continue;
    }
    if (token.type === 'list_item_open') taskLine = token.map?.[0];
    if (token.type === 'list_item_close') taskLine = undefined;
    if (token.type === 'tr_open') {
      row = token.map?.[0];
      tableColumn = 0;
    }
    if (token.type === 'tr_close') row = undefined;
    if (token.type !== 'inline') continue;

    const start = token.map?.[0] ?? row;
    if (start === undefined) continue;
    inlineLines.set(token, start);
    const fragments = token.content.split('\n');
    let offset = 0;
    const offsets = fragments.map(fragment => {
      const result = offset;
      offset += fragment.length + 1;
      return result;
    });
    const columns = fragments.map((fragment, line) => {
      if (row !== undefined) {
        const column = lines[start].indexOf(fragment, tableColumn);
        if (column !== -1) tableColumn = column + fragment.length + 1;
        return column;
      }
      // Block parsing strips quote/list prefixes and trims inline content.
      return lines[start + line]?.lastIndexOf(fragment) ?? -1;
    });
    analyzeInline(token, start, offsets, prose, hasIsolatedContent, taskLine === start, (line, from, to) => {
      const column = columns[line];
      if (to <= from || column < 0) return;
      isolates[start + line].push({ from: column + from, to: column + to });
    });
  }

  let previous: TextDirection = 'rtl';
  const directions = lines.map((_, line): TextDirection => {
    if (code[line]) return 'ltr';
    if (mode !== 'auto') return mode;
    const direction = classifyProse(prose[line]);
    if (direction) previous = direction;
    return direction ?? (hasIsolatedContent[line] ? 'ltr' : previous);
  });
  for (const list of isolates) {
    // Keep outer ranges when a match also falls inside an isolated span.
    list.sort((a, b) => a.from - b.from || b.to - a.to);
    let size = 0;
    for (const range of list) {
      if (size === 0 || list[size - 1].to <= range.from) list[size++] = range;
    }
    list.length = size;
  }
  return { tokens, directions, isolates, inlineLines };
}

export function getMarkdownLineDirections(source: string, mode: NoteDir): TextDirection[] {
  return analyzeMarkdown(source, mode).directions;
}
