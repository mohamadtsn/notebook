import { useState, useEffect, useCallback } from 'react';
import { getItem, setItem } from '../utils/storage';

export function useDarkMode() {
  const [dark, setDark] = useState(() => getItem<boolean>('notebook_dark', false));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const toggle = useCallback(() => {
    setDark(d => {
      const next = !d;
      setItem('notebook_dark', next);
      return next;
    });
  }, []);

  return { dark, toggle };
}