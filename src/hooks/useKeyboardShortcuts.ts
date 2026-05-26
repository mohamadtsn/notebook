import { useEffect, type RefObject } from 'react';

interface Options {
  onNewNote: () => void;
  onDeselect: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
}

export function useKeyboardShortcuts({ onNewNote, onDeselect, searchRef }: Options) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === 'n') {
        e.preventDefault();
        onNewNote();
      }

      if (ctrl && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }

      if (e.key === 'Escape') {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
          active.blur();
        } else {
          onDeselect();
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onNewNote, onDeselect, searchRef]);
}