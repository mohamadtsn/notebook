import type { Db } from './db.ts';

export type Tier = 'free' | 'pro';
export const TIERS: Tier[] = ['free', 'pro'];

/**
 * A comma-separated email allowlist from the environment, normalised the same way
 * `users.email` is stored: trimmed and lowercased.
 *
 * Read per call rather than captured at boot. It is a handful of string splits, and it
 * means `requireAdmin` answers from the environment the process has *now* — authority is
 * never carried in a token claim, where a promotion or a revocation made today would be
 * ignored for the thirty days that token stays valid.
 *
 * Unset is nobody, never everybody: `''.split(',')` yields `['']`, which `filter(Boolean)`
 * drops. Getting that backwards would hand every account admin rights on a fresh install.
 */
function allowlist(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
  );
}

export function isProEmail(email: string): boolean {
  return allowlist('PRO_EMAILS').has(email.trim().toLowerCase());
}

export function isAdminEmail(email: string): boolean {
  return allowlist('ADMIN_EMAILS').has(email.trim().toLowerCase());
}

/**
 * Promotes a whitelisted address to `pro`. Runs on register and on every login, so an
 * address added to `PRO_EMAILS` takes effect the next time that person signs in.
 *
 * Two rules that look like omissions and are not:
 *
 * - **`tier_locked` rows are skipped.** An admin who demotes a still-whitelisted account
 *   in the panel means it; re-promoting them on their next login would make the panel
 *   appear to lie. The env seeds, the admin decides.
 * - **It never demotes.** Removing an address from `PRO_EMAILS` does not take anything
 *   away — revoking is the panel's job, and a typo in a deploy env should not silently
 *   downgrade accounts.
 */
export function seedTier(db: Db, user: { id: string; email: string }): void {
  if (!isProEmail(user.email)) return;
  db.prepare("UPDATE users SET tier = 'pro' WHERE id = ? AND tier_locked = 0").run(user.id);
}
