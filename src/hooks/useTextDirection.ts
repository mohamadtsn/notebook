import { useMemo } from 'react';
import { detectDirection } from '../utils/direction';

export function useTextDirection(text: string): 'rtl' | 'ltr' {
  return useMemo(() => detectDirection(text), [text]);
}