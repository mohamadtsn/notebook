import { useEffect } from 'react';

interface Options {
  onNewNote: () => void;
  onOpenPalette: () => void;
  onDeselect: () => void;
}

export function useKeyboardShortcuts({ onNewNote, onOpenPalette, onDeselect }: Options) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === 'n') {
        e.preventDefault();
        onNewNote();
      }

      if (ctrl && e.key === 'k') {
        e.preventDefault();
        onOpenPalette();
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
  }, [onNewNote, onOpenPalette, onDeselect]);
}
