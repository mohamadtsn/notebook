import type { Token } from 'markdown-it';
import type { NoteDir } from '../types/note.ts';
import { inlineSourceRange, markdownParser } from './markdownParser.ts';
import { analyzeMarkdown, classifyProse, isAutomaticLink, type TextDirection } from './markdownDirection.ts';
import DOMPurify from 'dompurify';

/**
 * Markdown → HTML for the editor preview. The output goes into
 * `dangerouslySetInnerHTML`, so this file is an XSS surface with two layers, and
 * BOTH must stay:
 *
 * 1. `html: false` — raw HTML in the source is escaped by the parser, never parsed.
 * 2. DOMPurify on the result — defence in depth, and the thing that actually strips
 *    an `onerror=` or a `javascript:` href if the parser ever lets one through.
 *
 * `src/utils/checks.ts` asserts both; run `npm run check` after any edit here.
 * Images are deliberately not allowed: they would need `onerror` handling and they
 * let a note phone home to a third-party host just by being previewed.
 *
 * External links open in a new tab and are severed from this document. This runs as a
 * DOMPurify hook rather than a markdown-it renderer rule because DOMPurify drops
 * `target` on its own pass — setting it here means it is applied last and survives.
 */
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.nodeName !== 'A') return;
  const href = node.getAttribute('href') ?? '';
  if (!/^(https?:)?\/\//i.test(href)) return;
  node.setAttribute('target', '_blank');
  node.setAttribute('rel', 'noopener noreferrer nofollow');
});

/** Everything the preview is allowed to contain. Anything else is stripped. */
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'strong', 'em', 'del', 's', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span',
];

const textBlocks = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th', 'td']);
const containers = new Set(['li', 'ul', 'ol', 'blockquote']);

function prepareInline(children: Token[], base: TextDirection) {
  const lines = [{ prose: '', isolated: false }];
  let automaticLink = false;
  let link: Token | undefined;
  let label = '';
  for (const token of children) {
    if (token.tag === 'br') {
      lines.push({ prose: '', isolated: false });
      continue;
    }

    const line = lines[lines.length - 1];
    if (token.type === 'link_open') {
      link = token;
      automaticLink = isAutomaticLink(token);
      label = '';
      if (automaticLink) line.isolated = true;
    } else if (token.type === 'link_close' && link) {
      link.attrSet('dir', automaticLink ? 'ltr' : classifyProse(label) ?? base);
      link = undefined;
      automaticLink = false;
    } else if (token.type === 'code_inline') {
      token.attrSet('dir', 'ltr');
      line.isolated = true;
    } else if (token.type === 'text' && !automaticLink) {
      line.prose += token.content;
      if (link) label += token.content;
    }
  }
  return lines;
}

function wrapLines(children: Token[], dirs: TextDirection[]): string {
  const { renderer, options } = markdownParser;
  const stack: Token[] = [];
  let index = 0;
  let html = `<span class="markdown-line" dir="${dirs[index]}">`;
  for (const token of children) {
    if (token.tag === 'br') {
      for (let i = stack.length - 1; i >= 0; i--) html += `</${stack[i].tag}>`;
      html += `</span><br><span class="markdown-line" dir="${dirs[++index]}">`;
      for (const open of stack) html += renderer.renderInline([open], options, {});
      continue;
    }
    if (token.nesting === 1) stack.push(token);
    if (token.nesting === -1) stack.pop();
    html += renderer.renderInline([token], options, {});
  }
  return html + '</span>';
}

export function renderMarkdown(text: string, mode: NoteDir = 'auto'): string {
  const { tokens, directions, inlineLines } = analyzeMarkdown(text, mode);
  const parents: Token[] = [];
  const listDirections = new Map<Token, Set<TextDirection>>();

  for (const token of tokens) {
    if (token.nesting === 1) {
      parents.push(token);
      const align = /^text-align:(left|center|right)$/.exec(String(token.attrGet('style') ?? ''))?.[1];
      if (align) token.attrSet('align', align);
      continue;
    }
    if (token.nesting === -1) {
      parents.pop();
      continue;
    }
    if (token.type !== 'inline') continue;
    const parent = parents.at(-1);
    const start = inlineLines.get(token) ?? 0;
    const children = token.children ?? [];
    const visibleLines = prepareInline(children, directions[start]);
    const sourceLines = token.content.split('\n');
    let line = 0;
    let offset = sourceLines[0].length + 1;
    const sourceDirections = [directions[start]];
    for (const child of children) {
      if (child.tag !== 'br') continue;
      const end = inlineSourceRange(child)?.to ?? offset;
      while (line + 1 < sourceLines.length && offset <= end) {
        line++;
        offset += sourceLines[line].length + 1;
      }
      sourceDirections.push(directions[start + line]);
    }
    const item = parents.findLast(node => node.tag === 'li');
    const taskStart = item?.map?.[0] === start;
    const dirs = visibleLines.map(({ prose, isolated }, i) => {
      if (mode !== 'auto') return mode;
      const text = i === 0 && taskStart ? prose.replace(/^\[[ xX]\](?=\s|$)/, '') : prose;
      return classifyProse(text) ?? (isolated ? 'ltr' : sourceDirections[i]);
    });
    const dir = dirs[0];

    if (parent && !parent.hidden && textBlocks.has(parent.tag)) parent.attrSet('dir', dir);
    for (const container of parents) {
      if (!containers.has(container.tag)) continue;
      if (!container.attrGet('dir')) container.attrSet('dir', dir);
    }
    if (item && parents[parents.indexOf(item) - 1]) {
      const list = parents[parents.indexOf(item) - 1];
      const used = listDirections.get(list) ?? new Set<TextDirection>();
      used.add(item.attrGet('dir') as TextDirection);
      listDirections.set(list, used);
    }
    if (dirs.some(lineDir => lineDir !== dir)) {
      // The source parser still escapes raw HTML. This token contains only rendered,
      // escaped child tokens and our line wrappers, and goes through the sanitizer.
      const TokenClass = token.constructor as new (type: string, tag: string, nesting: 0) => Token;
      const wrapper = new TokenClass('html_inline', '', 0);
      wrapper.content = wrapLines(children, dirs);
      token.children = [wrapper];
    }
  }
  for (const [list, used] of listDirections) {
    if (used.size > 1) list.attrJoin('class', 'markdown-mixed-list');
  }

  const html = markdownParser.renderer.render(tokens, markdownParser.options, {});
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'align', 'dir', 'start'],
    ADD_URI_SAFE_ATTR: ['dir', 'align', 'start'],
    // `//host` reads as a local path but is protocol-relative; it is a normal external
    // link and is treated as one, not as same-origin.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|[/#.]|\/\/)/i,
    FORBID_ATTR: ['style'],
    RETURN_DOM: true,
  }) as HTMLElement;
  for (const pre of clean.querySelectorAll('pre')) pre.setAttribute('dir', 'ltr');
  return clean.innerHTML;
}
