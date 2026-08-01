const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, c => ESCAPE_MAP[c]);
}

/**
 * Longest line that still gets inline formatting. The lazy quantifiers below backtrack
 * badly on pathological input (a line of thousands of `*`), and the preview re-renders
 * while the user types — so the failure mode is a frozen tab. No real note needs more.
 */
const MAX_INLINE = 10_000;

/** Anything that isn't a plain navigable URL becomes inert — blocks javascript:/data: hrefs. */
function safeUrl(url: string): string {
  const trimmed = url.trim();
  // `//host` reads as a local path but is protocol-relative: it leaves the origin.
  if (trimmed.startsWith('//')) return '#';
  return /^(https?:\/\/|mailto:|\/|#|\.)/i.test(trimmed) ? trimmed : '#';
}

/**
 * Escapes FIRST, then applies inline rules, so no user-authored markup ever
 * reaches the DOM. The output is fed to dangerouslySetInnerHTML — every new
 * construct added here must keep the escape-before-replace order.
 */
function renderInline(text: string): string {
  const escaped = escapeHtml(text);
  // Past the ceiling the text is still shown — escaped and unformatted, never dropped.
  if (escaped.length > MAX_INLINE) return escaped;

  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(
      /\[(.+?)\]\((.+?)\)/g,
      (_, label: string, url: string) =>
        `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
    );
}

export function renderMarkdown(text: string): string {
  const lines = text.split('\n');
  const html: string[] = [];
  let inCodeBlock = false;
  let inList = false;
  let listType: 'ul' | 'ol' = 'ul';

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        html.push('</code></pre>');
        inCodeBlock = false;
      } else {
        if (inList) { html.push(`</${listType}>`); inList = false; }
        html.push('<pre><code>');
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) { html.push(escapeHtml(line)); continue; }

    const h3 = line.match(/^### (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h1 = line.match(/^# (.+)/);
    if (h1 || h2 || h3) {
      if (inList) { html.push(`</${listType}>`); inList = false; }
      const level = h1 ? 1 : h2 ? 2 : 3;
      html.push(`<h${level}>${renderInline((h1 ?? h2 ?? h3)![1])}</h${level}>`);
      continue;
    }

    const ulMatch = line.match(/^[-*] (.+)/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) html.push(`</${listType}>`);
        html.push('<ul>'); inList = true; listType = 'ul';
      }
      html.push(`<li>${renderInline(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = line.match(/^\d+\. (.+)/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) html.push(`</${listType}>`);
        html.push('<ol>'); inList = true; listType = 'ol';
      }
      html.push(`<li>${renderInline(olMatch[1])}</li>`);
      continue;
    }

    if (inList && line.trim() === '') { html.push(`</${listType}>`); inList = false; }
    if (line.match(/^---+$/)) { html.push('<hr />'); continue; }
    if (line.trim() === '') { html.push('<br />'); continue; }

    html.push(`<p>${renderInline(line)}</p>`);
  }

  if (inList) html.push(`</${listType}>`);
  if (inCodeBlock) html.push('</code></pre>');
  return html.join('\n');
}