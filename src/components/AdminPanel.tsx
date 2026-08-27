import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { api, type AdminUser } from '../utils/api';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { SegmentedControl } from './ui/SegmentedControl';
import { Switch } from './ui/Switch';
import { useToast } from './ui/toast-context';

const PAGE = 50;

const TIERS: { value: AdminUser['tier']; label: string }[] = [
  { value: 'free', label: 'عادی' },
  { value: 'pro', label: 'ارتقایافته' },
];

const formatDate = (ms: number) => new Date(ms).toLocaleDateString('fa-IR');

/**
 * The maintenance screen, rendered inside Settings only when `/auth/me` says the account
 * is an admin. There is no router in this app and a whole shell for one screen would be
 * the wrong trade; "hidden" here means invisible and unreachable without the flag, and
 * the real gate is `requireAdmin` on the server — the UI hiding is convenience.
 *
 * Rows, not a `<table>`: the panel is a phone-width column with `overflow-x-hidden`, and
 * a table with five columns would put a horizontal scrollbar inside it.
 */
export function AdminPanel({ token }: { token: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useToast();

  // Inline rather than calling a setState-bearing helper, matching SessionsSection.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const page = await api.admin.users(token, PAGE, 0);
        if (!live) return;
        setUsers(page.users);
        setTotal(page.total);
        setFailed(false);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => { live = false; };
  }, [token]);

  const more = async () => {
    try {
      const page = await api.admin.users(token, PAGE, users.length);
      setUsers(prev => [...prev, ...page.users]);
      setTotal(page.total);
    } catch {
      setFailed(true);
    }
  };

  /**
   * Optimistic, then reconciled: the row moves at once and is put back if the server
   * refuses. Refusal is a real case here — an admin may not demote or disable
   * themselves, and the server is where that rule lives.
   */
  const patch = async (user: AdminUser, change: Partial<Pick<AdminUser, 'tier' | 'disabled'>>) => {
    const before = { tier: user.tier, disabled: user.disabled };
    setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, ...change } : u)));
    setBusy(user.id);
    try {
      await api.admin.patchUser(token, user.id, change);
      setFailed(false);
    } catch {
      setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, ...before } : u)));
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const setDisabled = (user: AdminUser, disabled: boolean) => {
    void patch(user, { disabled });
    // Reversible, so it happens immediately and the undo lives in the toast — no confirm
    // dialog. PRODUCT.md principle 4.
    toast(disabled ? `${user.email} غیرفعال شد` : `${user.email} فعال شد`, {
      action: { label: 'واگرد', onClick: () => void patch(user, { disabled: !disabled }) },
    });
  };

  const signOutEverywhere = async (user: AdminUser) => {
    setBusy(user.id);
    try {
      await api.admin.revokeSessions(token, user.id);
      setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, sessionCount: 0 } : u)));
      // No undo action: a revoked session cannot be handed back. The user signs in again.
      toast(`${user.email} از همه دستگاه‌ها خارج شد`);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {failed && (
        <p className="mb-2 text-xs leading-relaxed text-destructive">
          ارتباط با سرور برقرار نشد.
        </p>
      )}

      <ul className="space-y-1">
        {users.map(user => (
          <li
            key={user.id}
            className="border-b border-separator py-3 last:border-b-0"
            aria-busy={busy === user.id || undefined}
          >
            {/* `dir="ltr"` on the address only: an email is an LTR string and reversing
                its dots and @ inside a Persian column is unreadable (DESIGN.md §7). */}
            <p dir="ltr" className="truncate text-start text-sm text-ink">{user.email}</p>
            <p className="mt-0.5 text-xs text-muted">
              {`${user.noteCount} یادداشت · ${user.sessionCount} دستگاه · ${user.aiUsedToday} درخواست امروز · ${formatDate(user.createdAt)}`}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <SegmentedControl
                options={TIERS}
                value={user.tier}
                onChange={tier => void patch(user, { tier })}
                label={`سطح حساب ${user.email}`}
              />
              <span className="flex items-center gap-2 text-xs text-muted">
                فعال
                <Switch
                  checked={!user.disabled}
                  onChange={enabled => setDisabled(user, !enabled)}
                  label={`وضعیت حساب ${user.email}`}
                />
              </span>
              <IconButton
                label="خروج از همه دستگاه‌ها"
                tone="danger"
                disabled={user.sessionCount === 0}
                onClick={() => void signOutEverywhere(user)}
              >
                <LogOut size={16} />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>

      {users.length < total && (
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => void more()}>
          {`نمایش بیشتر (${users.length} از ${total})`}
        </Button>
      )}
    </>
  );
}
