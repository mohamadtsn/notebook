import { useCallback, useState } from 'react';
import { api } from '../utils/api';
import { getItem, setItem } from '../utils/storage';
import { clearAiCache } from '../utils/aiCache';

const TOKEN_KEY = 'notebook_token';
const EMAIL_KEY = 'notebook_email';
/** Pull cursor. Cleared with the token so the next account starts from zero. */
export const LAST_PULL_KEY = 'notebook_last_pull';

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => getItem<string | null>(TOKEN_KEY, null));
  const [email, setEmail] = useState<string | null>(() => getItem<string | null>(EMAIL_KEY, null));

  const signIn = useCallback(async (
    mode: 'login' | 'register',
    addr: string,
    password: string,
  ) => {
    const { token: t } = await api[mode](addr, password);
    setItem(TOKEN_KEY, t);
    setItem(EMAIL_KEY, addr);
    setItem(LAST_PULL_KEY, 0);
    setToken(t);
    setEmail(addr);
  }, []);

  /** Signing out is not a data-loss event: the token goes, every local note stays. */
  const signOut = useCallback(() => {
    // Note the asymmetry, and keep it: signing out KEEPS every local note (a stated
    // product promise) but drops the AI cache. The cache is derived data that may hold
    // text from this user's notes, and it has no value to the next account on a shared
    // device.
    clearAiCache();
    setItem(TOKEN_KEY, null);
    setItem(EMAIL_KEY, null);
    setItem(LAST_PULL_KEY, 0);
    setToken(null);
    setEmail(null);
  }, []);

  return { token, email, signIn, signOut };
}