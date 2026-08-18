import { useEffect } from 'react';

interface Options {
  onNewNote: () => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
  onDeselect: () => void;
}

export function useKeyboardShortcuts({
  onNewNote, onOpenPalette, onOpenSettings, onDeselect,
}: Options) {
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

      if (ctrl && e.key === ',') {
        e.preventDefault();
        onOpenSettings();
      }

      if (e.key === 'Escape') {
        // A dialog owns its own Escape. Without this the note is deselected behind an
        // open palette / auth form / settings panel while that layer closes.
        if (document.querySelector('[role="dialog"]')) return;
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
  }, [onNewNote, onOpenPalette, onOpenSettings, onDeselect]);
}
