import { useState, type RefObject } from 'react';
import { motion } from 'motion/react';
import {
  CaseSensitive, ChevronDown, ChevronUp, Replace, Search, WholeWord, X,
} from 'lucide-react';
import { popIn } from '../lib/motion';
import { useTextDirection } from '../hooks/useTextDirection';
import { IconButton } from './ui/IconButton';

interface EditorSearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  activeIndex: number;
  caseSensitive: boolean;
  onToggleCaseSensitive: () => void;
  wholeWord: boolean;
  onToggleWholeWord: () => void;
  onNext: () => void;
  onPrev: () => void;
  canReplace: boolean;
  onReplaceCurrent: (replacement: string) => void;
  onReplaceAll: (replacement: string) => void;
  onClose: () => void;
  /** Opened via keyboard (`Ctrl+F`) -> instant, 0ms animation. DESIGN.md §5. */
  instant: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function EditorSearchBar({
  query,
  onQueryChange,
  matchCount,
  activeIndex,
  caseSensitive,
  onToggleCaseSensitive,
  wholeWord,
  onToggleWholeWord,
  onNext,
  onPrev,
  canReplace,
  onReplaceCurrent,
  onReplaceAll,
  onClose,
  instant,
  inputRef,
}: EditorSearchBarProps) {
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacement, setReplacement] = useState('');

  const queryDir = useTextDirection(query);
  const replaceDir = useTextDirection(replacement);
  const hasQuery = query.trim().length > 0 || (caseSensitive && query.length > 0);

  return (
    <motion.div
      role="search"
      aria-label="جستجو در یادداشت"
      {...(instant ? {} : popIn)}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      className="glass-panel flex flex-col gap-1.5 rounded-2xl p-1.5"
    >
      <div className="flex flex-wrap items-center gap-0.5 sm:flex-nowrap">
        <Search size={14} className="ms-2 me-1 shrink-0 text-muted" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) onPrev();
              else onNext();
            }
          }}
          dir={query ? queryDir : 'rtl'}
          placeholder="جستجو در متن یادداشت…"
          aria-label="جستجو در متن یادداشت"
          className="min-w-36 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-muted"
        />

        <span aria-live="polite" className="shrink-0 px-1.5 text-xs tabular-nums">
          {hasQuery ? (
            matchCount === 0 ? (
              <span className="font-medium text-destructive">بدون نتیجه</span>
            ) : (
              <span className="text-muted">
                {(activeIndex + 1).toLocaleString('fa-IR')} از {matchCount.toLocaleString('fa-IR')}
              </span>
            )
          ) : null}
        </span>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            label="تطابق دقیق حروف و نگارش"
            active={caseSensitive}
            onClick={onToggleCaseSensitive}
          >
            <CaseSensitive size={16} />
          </IconButton>

          <IconButton
            label="فقط کلمهٔ کامل"
            active={wholeWord}
            onClick={onToggleWholeWord}
          >
            <WholeWord size={16} />
          </IconButton>

          <IconButton
            label="مورد قبلی (Shift+Enter)"
            disabled={matchCount === 0}
            onClick={onPrev}
          >
            <ChevronUp size={16} />
          </IconButton>

          <IconButton
            label="مورد بعدی (Enter)"
            disabled={matchCount === 0}
            onClick={onNext}
          >
            <ChevronDown size={16} />
          </IconButton>

          {canReplace && (
            <IconButton
              label="جایگزینی متن"
              active={replaceOpen}
              onClick={() => setReplaceOpen(o => !o)}
            >
              <Replace size={15} />
            </IconButton>
          )}

          <IconButton label="بستن جستجو (Esc)" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
      </div>

      {replaceOpen && canReplace && (
        <div className="flex items-center gap-1.5 border-t border-separator pt-1.5 ps-2 pe-1">
          <input
            type="text"
            value={replacement}
            onChange={e => setReplacement(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (matchCount > 0) onReplaceCurrent(replacement);
              }
            }}
            dir={replacement ? replaceDir : 'rtl'}
            placeholder="جایگزینی با…"
            aria-label="متن جایگزین"
            className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-muted"
          />

          <button
            type="button"
            disabled={matchCount === 0}
            onClick={() => onReplaceCurrent(replacement)}
            className="min-h-8 shrink-0 rounded-lg bg-fill px-2.5 py-1 text-xs font-medium text-ink transition-[background-color,transform] duration-(--d-press) hover:bg-accent-soft active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          >
            جایگزینی
          </button>

          <button
            type="button"
            disabled={matchCount === 0}
            onClick={() => onReplaceAll(replacement)}
            className="min-h-8 shrink-0 rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-on-accent transition-[opacity,transform] duration-(--d-press) hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          >
            همه
          </button>
        </div>
      )}
    </motion.div>
  );
}
