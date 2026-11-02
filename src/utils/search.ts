import type { Note } from '../types/note.ts';
import type { Group } from '../types/group.ts';

export interface MatchRange {
  from: number;
  to: number;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface Snippet {
  text: string;
  matches: MatchRange[];
  prefixEllipsis: boolean;
  suffixEllipsis: boolean;
}

export interface NoteSearchResult {
  note: Note;
  score: number;
  titleMatches: MatchRange[];
  bodyMatchCount: number;
  firstBodyMatch: MatchRange | null;
  snippet: Snippet;
}

interface InternalNormalized {
  normalized: string;
  startMap: number[];
  endMap: number[];
  map: number[];
}

/**
 * Arabic/Persian combining marks (harakat, hamza above/below, superscript alef)
 * and tatweel (kashida). Stripped during smart search so decorated text matches
 * plain queries while `endMap` keeps the raw character boundaries intact.
 */
function isStrippedMark(code: number): boolean {
  return (code >= 0x064b && code <= 0x065f) || code === 0x0670 || code === 0x0640;
}

function foldChar(ch: string, code: number, caseSensitive: boolean): string {
  // Persian digits ۰-۹ (0x06F0..0x06F9)
  if (code >= 0x06f0 && code <= 0x06f9) {
    return String.fromCharCode(0x30 + (code - 0x06f0));
  }
  // Arabic-Indic digits ٠-٩ (0x0660..0x0669)
  if (code >= 0x0660 && code <= 0x0669) {
    return String.fromCharCode(0x30 + (code - 0x0660));
  }
  if (caseSensitive) return ch;

  switch (code) {
    case 0x064a: // ي Arabic Yeh
    case 0x0649: // ى Alef Maksura
    case 0x0626: // ئ Yeh with Hamza above
    case 0x06d2: // ے Yeh Barree
      return '\u06cc'; // ی Persian Yeh
    case 0x0643: // ك Arabic Kaf
      return '\u06a9'; // ک Persian Kaf
    case 0x06c0: // ۀ Heh with Yeh above
    case 0x0629: // ة Teh Marbuta
      return '\u0647'; // ه Heh
    case 0x0624: // ؤ Waw with Hamza above
      return '\u0648'; // و Waw
    case 0x0622: // آ Alef with Madda
    case 0x0623: // أ Alef with Hamza above
    case 0x0625: // إ Alef with Hamza below
    case 0x0671: // ٱ Alef Wasla
      return '\u0627'; // ا Alef
    case 0x200c: // ZWNJ (half-space) -> normal space in standard pass
    case 0x00a0: // NBSP
      return ' ';
    default:
      return ch.toLowerCase();
  }
}

function buildNormalized(
  text: string,
  caseSensitive = false,
  collapseZwnj = false,
): InternalNormalized {
  const chars: string[] = [];
  const startMap: number[] = [];
  const endMap: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);

    if (!caseSensitive && isStrippedMark(code)) {
      if (endMap.length > 0) {
        endMap[endMap.length - 1] = i + 1;
      }
      continue;
    }

    if (!caseSensitive && collapseZwnj && code === 0x200c) {
      if (endMap.length > 0) {
        endMap[endMap.length - 1] = i + 1;
      }
      continue;
    }

    const folded = foldChar(text[i], code, caseSensitive);
    // Collapse consecutive spaces/ZWNJ runs in smart mode so "می  روم" matches "می‌روم"
    if (!caseSensitive && folded === ' ' && chars.length > 0 && chars[chars.length - 1] === ' ') {
      endMap[endMap.length - 1] = i + 1;
      continue;
    }

    for (let k = 0; k < folded.length; k++) {
      chars.push(folded[k]);
      startMap.push(i);
      endMap.push(i + 1);
    }
  }

  const normalized = chars.join('');
  const map = [...startMap, text.length];
  return { normalized, startMap, endMap, map };
}

/**
 * Normalizes Persian/Arabic/Latin text and returns an offset map where `map[i]` is
 * the UTF-16 code-unit index in `text` for normalized index `i`, and
 * `map[normalized.length] === text.length`.
 */
export function normalizeWithMap(
  text: string,
  caseSensitive = false,
): { normalized: string; map: number[] } {
  const { normalized, map } = buildNormalized(text, caseSensitive, false);
  return { normalized, map };
}

const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

function isWordBoundary(text: string, from: number, to: number): boolean {
  if (from > 0) {
    const prev = text[from - 1];
    if ( prev !== '\u200c' && WORD_CHAR_RE.test(prev)) return false;
  }
  if (to < text.length) {
    const next = text[to];
    if (next !== '\u200c' && WORD_CHAR_RE.test(next)) return false;
  }
  return true;
}

function collectPassMatches(
  text: string,
  normText: InternalNormalized,
  normQuery: string,
  wholeWord: boolean,
): MatchRange[] {
  if (!normQuery) return [];
  const results: MatchRange[] = [];
  let pos = 0;

  while (pos <= normText.normalized.length - normQuery.length) {
    const idx = normText.normalized.indexOf(normQuery, pos);
    if (idx === -1) break;

    const rawFrom = normText.startMap[idx];
    const rawTo = normText.endMap[idx + normQuery.length - 1];

    if (!wholeWord || isWordBoundary(text, rawFrom, rawTo)) {
      results.push({ from: rawFrom, to: rawTo });
      pos = idx + Math.max(1, normQuery.length);
    } else {
      pos = idx + 1;
    }
  }

  return results;
}

function mergeNonOverlapping(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from));
  const out: MatchRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (!last || r.from >= last.to) {
      out.push(r);
    }
  }
  return out;
}

/**
 * Finds all non-overlapping occurrences of `query` in `text`, returning exact raw
 * UTF-16 `[from, to)` offsets into `text`.
 */
export function findMatches(
  text: string,
  query: string,
  options: SearchOptions = {},
): MatchRange[] {
  const caseSensitive = options.caseSensitive ?? false;
  const wholeWord = options.wholeWord ?? false;

  const trimmedQuery = caseSensitive ? query : query.trim();
  if (!trimmedQuery || !text) return [];

  const normText = buildNormalized(text, caseSensitive, false);
  const normQuery = buildNormalized(trimmedQuery, caseSensitive, false).normalized;
  const primary = collectPassMatches(text, normText, normQuery, wholeWord);

  if (caseSensitive) return primary;

  // Second pass: ZWNJ-collapsed matching so "میروم" matches "می‌روم" and vice versa.
  const collapsedQuery = buildNormalized(trimmedQuery.replace(/\u200c/g, ''), false, true).normalized;
  if (!collapsedQuery) return primary;

  const collapsedText = buildNormalized(text, false, true);
  const secondary = collectPassMatches(text, collapsedText, collapsedQuery, wholeWord);

  if (secondary.length === 0) return primary;
  if (primary.length === 0) return secondary;
  return mergeNonOverlapping([...primary, ...secondary]);
}

/**
 * Replaces either a single match at `index` or all `matches` in `text` using their
 * exact raw `[from, to)` slices. Returns the updated string and the new caret offset.
 */
export function replaceMatches(
  text: string,
  matches: MatchRange[],
  replacement: string,
  index?: number,
): { value: string; caret: number } {
  if (matches.length === 0) return { value: text, caret: 0 };

  if (index !== undefined) {
    const target = matches[index];
    if (!target) return { value: text, caret: 0 };
    const value = text.slice(0, target.from) + replacement + text.slice(target.to);
    const caret = target.from + replacement.length;
    return { value, caret };
  }

  let out = '';
  let cursor = 0;
  let lastCaret = 0;
  for (const m of matches) {
    if (m.from < cursor) continue;
    out += text.slice(cursor, m.from) + replacement;
    lastCaret = out.length;
    cursor = m.to;
  }
  out += text.slice(cursor);
  return { value: out, caret: lastCaret };
}

/**
 * Extracts a single-line or compact context window around the first match in `body`,
 * rebasing match offsets so `<HighlightText>` can highlight within the snippet directly.
 */
export function buildSnippet(body: string, query: string, maxLen = 96): Snippet {
  const cleanBody = body.replace(/\r?\n+/g, ' ').trim();
  if (!cleanBody) {
    return { text: '', matches: [], prefixEllipsis: false, suffixEllipsis: false };
  }

  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const phraseMatches = findMatches(cleanBody, query);
  const allTokenMatches = tokens.length > 1
    ? mergeNonOverlapping([
        ...phraseMatches,
        ...tokens.flatMap(t => findMatches(cleanBody, t)),
      ])
    : phraseMatches;

  if (allTokenMatches.length === 0) {
    const sliced = cleanBody.slice(0, maxLen);
    return {
      text: sliced,
      matches: [],
      prefixEllipsis: false,
      suffixEllipsis: cleanBody.length > maxLen,
    };
  }

  const first = allTokenMatches[0];
  const matchLen = first.to - first.from;
  const padBefore = Math.max(12, Math.floor((maxLen - matchLen) / 2));

  let start = Math.max(0, first.from - padBefore);
  if (start > 0) {
    const nextSpace = cleanBody.indexOf(' ', start);
    if (nextSpace !== -1 && nextSpace < first.from) {
      start = nextSpace + 1;
    }
  }

  let end = Math.min(cleanBody.length, start + maxLen);
  if (end < cleanBody.length) {
    const lastSpace = cleanBody.lastIndexOf(' ', end);
    if (lastSpace > first.to) {
      end = lastSpace;
    }
  }

  const text = cleanBody.slice(start, end);
  const matches: MatchRange[] = [];
  for (const m of allTokenMatches) {
    if (m.to <= start || m.from >= end) continue;
    matches.push({
      from: Math.max(0, m.from - start),
      to: Math.min(text.length, m.to - start),
    });
  }

  return {
    text,
    matches: mergeNonOverlapping(matches),
    prefixEllipsis: start > 0,
    suffixEllipsis: end < cleanBody.length,
  };
}

/**
 * Multi-token, Persian-aware search and relevance ranker across notes.
 */
export function searchNotes(
  notes: Note[],
  query: string,
  groups?: Map<string, Group>,
): NoteSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const results: NoteSearchResult[] = [];

  for (const note of notes) {
    const title = note.title.trim();
    const body = note.body;
    const groupName = (note.groupId && groups?.get(note.groupId)?.name) ?? '';

    const phraseTitleMatches = findMatches(title, trimmed);
    const phraseBodyMatches = findMatches(body, trimmed);

    // Every token must match somewhere in title, body, or group name
    let allTokensMatch = true;
    let allTokensInTitle = tokens.length > 0;
    const tokenTitleRanges: MatchRange[] = [...phraseTitleMatches];
    const tokenBodyRanges: MatchRange[] = [...phraseBodyMatches];

    for (const token of tokens) {
      const tMatches = findMatches(title, token);
      const bMatches = findMatches(body, token);
      const gMatches = groupName ? findMatches(groupName, token) : [];

      if (tMatches.length === 0 && bMatches.length === 0 && gMatches.length === 0) {
        allTokensMatch = false;
        break;
      }
      if (tMatches.length === 0) {
        allTokensInTitle = false;
      } else {
        tokenTitleRanges.push(...tMatches);
      }
      if (bMatches.length > 0) {
        tokenBodyRanges.push(...bMatches);
      }
    }

    if (!allTokensMatch) continue;

    const titleMatches = mergeNonOverlapping(tokenTitleRanges);
    const bodyMatches = mergeNonOverlapping(tokenBodyRanges);

    let score = 0;
    if (phraseTitleMatches.length > 0) {
      const first = phraseTitleMatches[0];
      if (first.from === 0 && first.to === title.length) {
        score += 1000; // Exact full title match
      } else if (first.from === 0) {
        score += 500; // Title prefix match
      } else {
        score += 300; // Phrase inside title
      }
    } else if (allTokensInTitle) {
      score += 200;
    } else if (titleMatches.length > 0) {
      score += 120;
    }

    if (phraseBodyMatches.length > 0) {
      score += 100;
    }
    score += Math.min(50, bodyMatches.length * 5);
    if (note.pinned && !note.deletedAt) {
      score += 25;
    }

    results.push({
      note,
      score,
      titleMatches,
      bodyMatchCount: bodyMatches.length,
      firstBodyMatch: bodyMatches[0] ?? null,
      snippet: buildSnippet(body, trimmed),
    });
  }

  return results.sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt);
}

/**
 * Matches a keyboard shortcut across both physical QWERTY key positions (`e.code`,
 * e.g. `'KeyF'`, `'KeyK'`) and layout-produced characters (`e.key`, including
 * Persian layout characters like `'ب'` on `KeyF` or `'ن'` on `KeyK`).
 *
 * Without this, pressing `Ctrl+F` or `Ctrl+K` while the OS keyboard is set to
 * Persian produces `e.key === 'ب'` / `'ن'`, which misses ASCII `e.key === 'f'`
 * checks and lets the browser hijack the shortcut for its native search bar.
 */
export function isShortcutKey(
  e: { code?: string; key: string },
  code: string,
  ...keys: string[]
): boolean {
  if (e.code === code) return true;
  const lower = e.key.toLowerCase();
  return keys.includes(lower) || keys.includes(e.key);
}
