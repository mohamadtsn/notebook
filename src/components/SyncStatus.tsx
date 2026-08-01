import { AlertCircle, Check, CloudOff, LogOut, RefreshCw, User } from 'lucide-react';
import type { SyncState } from '../hooks/useSync';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { cx } from './ui/cx';

interface SyncStatusProps {
  state: SyncState;
  email: string | null;
  pending: number;
  onSync: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

const LABEL: Record<SyncState, string> = {
  idle:    'همگام‌سازی',
  syncing: 'همگام‌سازی…',
  synced:  'همگام شد',
  error:   'خطا در همگام‌سازی',
  offline: 'آفلاین',
};

const ICON = {
  idle:    RefreshCw,
  syncing: RefreshCw,
  synced:  Check,
  error:   AlertCircle,
  offline: CloudOff,
} as const;

/**
 * Signed out this is just a sign-in button — sync is opt-in and the app is complete
 * without it. Signed in it announces state politely; a failure is reported, never
 * thrown in the user's way.
 */
export function SyncStatus({ state, email, pending, onSync, onSignIn, onSignOut }: SyncStatusProps) {
  if (!email) {
    return (
      <Button size="sm" onClick={onSignIn}>
        <User size={16} />
        <span className="hidden sm:inline">ورود</span>
      </Button>
    );
  }

  const Icon = ICON[state];
  const detail = pending > 0 && state !== 'syncing' ? ` (${pending} تغییر ذخیره‌نشده)` : '';

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onSync}
        // The text label is hidden below `sm`, so the control carries its own name.
        aria-label={`همگام‌سازی با ${email} — وضعیت: ${LABEL[state]}`}
        title={`${email} — برای همگام‌سازی کلیک کنید`}
        className={cx(
          'relative flex h-9 items-center gap-1.5 rounded-md px-2 text-xs',
          'after:absolute after:inset-x-0 after:inset-y-[-4px] after:content-[""]',
          state === 'error' ? 'text-destructive' : 'text-muted',
          'hover:bg-accent-soft',
        )}
      >
        <Icon size={15} className={state === 'syncing' ? 'animate-spin' : undefined} />
        <span className="hidden sm:inline">{LABEL[state]}</span>
      </button>

      <span aria-live="polite" className="sr-only">{LABEL[state]}{detail}</span>

      <IconButton label={`خروج از ${email}`} onClick={onSignOut}>
        <LogOut size={16} />
      </IconButton>
    </div>
  );
}