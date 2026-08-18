import MarkdownIt from 'markdown-it';
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
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,        // a single newline is a line break — this is a notes app, not a blog
  typographer: false,  // it rewrites quotes and dashes, which is wrong inside Persian text
});

md.disable(['image']);

/**
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
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(md.render(text), {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'align'],
    // `//host` reads as a local path but is protocol-relative; it is a normal external
    // link and is treated as one, not as same-origin.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|[/#.]|\/\/)/i,
    FORBID_ATTR: ['style'],
  });
}
