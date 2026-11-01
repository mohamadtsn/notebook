import type { ReactNode } from 'react';
import type { MatchRange } from '../../utils/search';
import { cx } from './cx';

interface HighlightTextProps {
  text: string;
  ranges?: MatchRange[];
  markClassName?: string;
}

/**
 * Slices `text` by raw UTF-16 `ranges` and wraps matched segments in `<mark>`.
 * Renders zero extra wrapper nodes when `ranges` is empty.
 */
export function HighlightText({ text, ranges, markClassName }: HighlightTextProps) {
  if (!ranges || ranges.length === 0 || !text) {
    return <>{text}</>;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;

  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const from = Math.max(cursor, Math.min(text.length, r.from));
    const to = Math.max(from, Math.min(text.length, r.to));
    if (from > cursor) {
      parts.push(text.slice(cursor, from));
    }
    if (to > from) {
      parts.push(
        <mark
          key={`${from}-${to}-${i}`}
          className={cx('rounded-[2px] bg-selection px-[1px] font-medium text-ink', markClassName)}
        >
          {text.slice(from, to)}
        </mark>,
      );
    }
    cursor = to;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return <>{parts}</>;
}
