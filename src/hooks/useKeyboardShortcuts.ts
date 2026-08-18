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
        // Something closer to the keypress already answered it — the advanced editor
        // collapsing a multi-cursor selection is the case that forced this. Closing the
        // note as well would make one press mean two things.
        if (e.defaultPrevented) return;
        // A dialog owns its own Escape. Without this the note is deselected behind an
        // open palette / auth form / settings panel while that layer closes.
        if (document.querySelector('[role="dialog"]')) return;
        const active = document.activeElement;
        // `isContentEditable` covers the advanced editor: it is a writing surface, not
        // a form control, and dropping it here closed the note instead of blurring.
        if (
          active instanceof HTMLInputElement
          || active instanceof HTMLTextAreaElement
          || (active instanceof HTMLElement && active.isContentEditable)
        ) {
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
