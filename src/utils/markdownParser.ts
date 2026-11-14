import MarkdownIt, { type StateInline, type Token } from 'markdown-it';

export const markdownParser = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,        // a single newline is a line break — this is a notes app, not a blog
  typographer: false,  // it rewrites quotes and dashes, which is wrong inside Persian text
});

markdownParser.disable(['image']);

interface InlineSourceRange {
  from: number;
  to: number;
}

const inlineSourceRanges = new WeakMap<Token, InlineSourceRange>();

export function inlineSourceRange(token: Token): InlineSourceRange | undefined {
  return inlineSourceRanges.get(token);
}

// Inline tokens normally carry no offsets. Record the positions consumed by the
// rules that can hide a source newline or create a run needing isolation.
function trackRule(name: string, types: string[]) {
  const ruler = markdownParser.inline.ruler;
  const rule = ruler.__rules__.find(entry => entry.name === name)!.fn;
  ruler.at(name, (state: StateInline, silent: boolean) => {
    const start = state.pos;
    const count = state.tokens.length;
    const protocol = name === 'linkify'
      ? /[a-z][a-z0-9+.-]*$/i.exec(state.pending.slice(-10))?.[0]
      : undefined;
    if (!rule(state, silent)) return false;
    if (silent) return true;
    const token = state.tokens.slice(count).findLast(entry => types.includes(entry.type));
    if (token) {
      const from = start - (protocol?.length ?? 0);
      inlineSourceRanges.set(token, { from, to: state.pos });
    }
    return true;
  });
}

trackRule('newline', ['softbreak', 'hardbreak']);
trackRule('escape', ['hardbreak']);
trackRule('backticks', ['code_inline']);
trackRule('autolink', ['link_open']);
trackRule('linkify', ['link_open']);
trackRule('link', ['link_close']);
