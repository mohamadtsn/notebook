const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, c => ESCAPE_MAP[c]);
}

function renderInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
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