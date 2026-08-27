import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type Me } from '../utils/api';
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

  /**
   * Who the token belongs to, as the server sees it right now. Fetched on mount and
   * whenever the token changes, never derived from the token itself — a tier or an admin
   * promotion has to take effect on the next request, not in thirty days.
   *
   * A 401 here is the disabled-account path. It goes through the ordinary `signOut`,
   * which keeps every local note: being locked out of sync is not a reason to lose
   * writing. `me` is `null` while it is in flight, which reads as `free` — the worst
   * that costs a pro user is a moment without the AI rows.
   */
  // Stored with the token it was fetched for, rather than cleared on sign-out: a bare
  // `me` would still be the previous account's for the render between a token change and
  // the response, which is exactly long enough to show a free account the AI rows.
  const [me, setMe] = useState<{ token: string; value: Me } | null>(null);
  const current = me?.token === token ? me.value : null;

  useEffect(() => {
    if (!token) return;
    let alive = true;
    // Inline rather than `void load(token)`, matching SessionsSection: the lint rule
    // reads an effect that calls a setState-bearing function as a synchronous cascade,
    // even when every write is behind an await.
    void (async () => {
      try {
        const value = await api.me(token);
        if (alive) setMe({ token, value });
      } catch (err) {
        if (!alive) return;
        // Anything else is a network blip; the app is offline-first and carries on.
        if (err instanceof ApiError && err.status === 401) signOut();
      }
    })();
    return () => { alive = false; };
  }, [token, signOut]);

  return {
    token,
    email,
    signIn,
    signOut,
    tier: current?.tier ?? 'free',
    isAdmin: current?.isAdmin ?? false,
  };
}