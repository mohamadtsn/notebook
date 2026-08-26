import { useMemo } from 'react';
import { detectDirection } from '../utils/direction';
import type { NoteDir } from '../types/note';

/**
 * `override` is the note's pinned direction. `auto` — the default — falls through to
 * `detectDirection`, which is what every call site did before pinning existed.
 */
export function useTextDirection(text: string, override: NoteDir = 'auto'): 'rtl' | 'ltr' {
  return useMemo(
    () => (override === 'auto' ? detectDirection(text) : override),
    [text, override],
  );
}