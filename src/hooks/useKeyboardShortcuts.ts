import { useEffect } from 'react';
import { isShortcutKey } from '../utils/search';

interface Options {
  onNewNote: () => void;
  onOpenPalette: () => void;
  onFocusSidebarSearch?: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onDeselect: () => void;
}

/**
 * A writing surface owns its keystrokes. `isContentEditable` covers the advanced
 * editor, which is neither an input nor a textarea.
 */
function isWriting(el: Element | null): boolean {
  return el instanceof HTMLInputElement
    || el instanceof HTMLTextAreaElement
    || (el instanceof HTMLElement && el.isContentEditable);
}

export function useKeyboardShortcuts({
  onNewNote, onOpenPalette, onFocusSidebarSearch, onOpenSettings, onOpenShortcuts, onDeselect,
}: Options) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && !e.shiftKey && !e.altKey && isShortcutKey(e, 'KeyN', 'n', 'د', 'أ')) {
        e.preventDefault();
        onNewNote();
        return;
      }

      if (ctrl && !e.shiftKey && !e.altKey && isShortcutKey(e, 'KeyK', 'k', 'ن', '«')) {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      if (ctrl && e.shiftKey && !e.altKey && isShortcutKey(e, 'KeyF', 'f', 'ب', 'إ') && onFocusSidebarSearch) {
        e.preventDefault();
        onFocusSidebarSearch();
        return;
      }

      // When no note is open (`Editor` did not claim Ctrl+F in capture phase), route
      // Ctrl+F to the sidebar search field instead of letting the browser open its own find bar.
      if (ctrl && !e.shiftKey && !e.altKey && isShortcutKey(e, 'KeyF', 'f', 'ب', 'إ')) {
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (!document.querySelector('[role="dialog"]') && onFocusSidebarSearch) {
          onFocusSidebarSearch();
        }
        return;
      }

      if (ctrl && !e.shiftKey && !e.altKey && isShortcutKey(e, 'Comma', ',', 'و', '<')) {
        e.preventDefault();
        onOpenSettings();
        return;
      }

      // No modifier, so this one has to yield to anyone typing — otherwise a «?» in a
      // note opens a panel instead of landing in the text. Same dialog guard as Escape.
      if ((e.key === '?' || e.key === '؟') && !ctrl && !e.altKey && !isWriting(document.activeElement)
          && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        onOpenShortcuts();
        return;
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
        if (isWriting(active)) {
          (active as HTMLElement).blur();
        } else {
          onDeselect();
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onNewNote, onOpenPalette, onFocusSidebarSearch, onOpenSettings, onOpenShortcuts, onDeselect]);
}
