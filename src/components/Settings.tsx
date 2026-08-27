import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import type { Settings as SettingsValue, AiSettings } from '../types/settings';
import { SYNC_INTERVALS } from '../types/settings';
import type { SyncState } from '../hooks/useSync';
import { Field } from './ui/Field';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { SegmentedControl } from './ui/SegmentedControl';
import { Select } from './ui/Select';
import { Switch } from './ui/Switch';
import { popIn } from '../lib/motion';
import { TARGET_LANGS } from '../utils/ai';
import { aiCacheSize, clearAiCache } from '../utils/aiCache';
import { api, type DeviceSession } from '../utils/api';
import { deviceLabel } from '../utils/device';
import { AdminPanel } from './AdminPanel';

interface SettingsProps {
  settings: SettingsValue;
  onUpdate: (patch: Partial<SettingsValue>) => void;
  onUpdateAi: (patch: Partial<AiSettings>) => void;
  email: string | null;
  /** Needed for the device list; `null` means signed out and the section is not shown. */
  token: string | null;
  /** From `/auth/me`, not from the token. `free` while signed out or still loading. */
  tier: 'free' | 'pro';
  isAdmin: boolean;
  syncState: SyncState;
  settingsState: SyncState;
  pending: number;
  onSync: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenShortcuts: () => void;
  onClose: () => void;
  /** Opened by keyboard → no enter animation. DESIGN.md §5. */
  instant: boolean;
}

// Not `as const`: SegmentedControl takes a mutable `{ value; label }[]` (see its use
// in EditorToolbar), and a readonly tuple does not satisfy that.
const THEMES: { value: SettingsValue['theme']; label: string }[] = [
  { value: 'light', label: 'روشن' },
  { value: 'dark', label: 'تیره' },
  { value: 'system', label: 'سیستم' },
];

const AI_MODES: { value: AiSettings['mode']; label: string }[] = [
  { value: 'proxy', label: 'سرور' },
  { value: 'direct', label: 'مستقیم' },
];

/** Shared by the three direct-mode text fields. */
const AI_INPUT =
  'min-h-11 w-56 rounded-lg border border-separator bg-fill px-3 text-sm text-ink outline-none focus:border-accent';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-separator px-5 py-4 last:border-b-0">
      <h3 className="mb-1 text-[1.0625rem] font-semibold leading-[1.35] tracking-[-0.01em] text-ink">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Settings(props: SettingsProps) {
  const { settings, onUpdate, onClose, onOpenShortcuts, instant } = props;
  const contentRef = useRef<HTMLDivElement>(null);

  // Focus moves into the *section list*, not the header: landing on «بستن» offers
  // leaving as the first thing the panel says. DESIGN.md §6.
  useEffect(() => {
    contentRef.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="scrim absolute inset-0" onClick={onClose} />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="تنظیمات"
        {...(instant ? {} : popIn)}
        className="glass-overlay relative flex max-h-[min(80vh,44rem)] w-full max-w-[34rem] flex-col rounded-3xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-separator px-5 py-3">
          <h2 className="text-lg font-semibold text-ink">تنظیمات</h2>
          <IconButton label="بستن" onClick={onClose}>
            <X size={17} />
          </IconButton>
        </header>

        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <Section title="ظاهر">
            <Field label="پوسته" description="«سیستم» از تنظیمات دستگاه پیروی می‌کند.">
              <SegmentedControl
                options={THEMES}
                value={settings.theme}
                onChange={theme => onUpdate({ theme })}
                label="پوسته"
              />
            </Field>

            <Field
              label="ادیتور پیشرفته"
              description="آزمایشی. چند نشانگر با Alt + کلیک. ممکن است در متن فارسی دقیق نباشد."
            >
              <Switch
                checked={settings.experimentalEditor}
                onChange={experimentalEditor => onUpdate({ experimentalEditor })}
                label="ادیتور پیشرفته (آزمایشی)"
              />
            </Field>

            <Field label="کلیدهای میان‌بر" description="یا کلید ؟ در هر جای برنامه.">
              <Button variant="ghost" onClick={onOpenShortcuts}>نمایش</Button>
            </Field>
          </Section>

          {/* No «درباره» account row: the sync section already states the account state
              and offers the way in. A section that only promises is clutter. */}
          <SyncSection {...props} />
          <SessionsSection {...props} />
          <AiSection {...props} />
          <AdminSection {...props} />
        </div>
      </motion.div>
    </div>
  );
}

function SyncSection({
  settings,
  onUpdate,
  email,
  syncState,
  settingsState,
  pending,
  onSync,
  onSignIn,
  onSignOut,
}: SettingsProps) {
  // Signed out this section is not disabled — it explains what an account adds and
  // offers the way in. PRODUCT.md principle 1: nothing is a locked door.
  if (!email) {
    return (
      <Section title="همگام‌سازی">
        <p className="mb-3 text-xs leading-relaxed text-muted">
          یادداشت‌های شما همین حالا روی این دستگاه ذخیره می‌شوند. با ساختن حساب، بین دستگاه‌ها
          همگام می‌شوند.
        </p>
        <Button variant="primary" size="sm" onClick={onSignIn}>
          ورود یا ثبت‌نام
        </Button>
      </Section>
    );
  }

  return (
    <Section title="همگام‌سازی">
      <Field label="حساب">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">{email}</span>
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            خروج
          </Button>
        </div>
      </Field>

      <Field label="فاصلهٔ همگام‌سازی" description="روی «خاموش» هم با بازگشت به برنامه همگام می‌شود.">
        {/* Values go through strings because «خاموش» is `null`, and a select's value
            cannot be null. */}
        <Select
          options={SYNC_INTERVALS.map(i => ({ value: String(i.value), label: i.label }))}
          value={String(settings.syncIntervalMs)}
          onChange={v => onUpdate({ syncIntervalMs: v === 'null' ? null : Number(v) })}
          label="فاصلهٔ همگام‌سازی"
        />
      </Field>

      <Field label="همگام‌سازی دستی" description={`${pending} یادداشت در صف`}>
        <Button variant="ghost" size="sm" onClick={onSync}>
          همگام‌سازی
        </Button>
      </Field>

      <Field label="وضعیت">
        <span aria-live="polite" className="text-xs text-muted">
          {syncState === 'error' || settingsState === 'error' ? 'خطا در همگام‌سازی' : 'به‌روز'}
        </span>
      </Field>
    </Section>
  );
}

/**
 * Two presses, not a dialog. DESIGN.md §6 gives `danger` a fill "only on confirm", and
 * §5's undo toast does not apply here: a revoked session cannot be un-revoked.
 */
function ConfirmButton({ label, confirmLabel, onConfirm }: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  // Disarm on its own, so a half-pressed button does not sit there waiting to fire.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <Button
      variant="danger"
      size="sm"
      className={armed ? 'bg-destructive text-on-accent hover:bg-destructive' : undefined}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}

function SessionsSection({ email, token, onSignOut }: SettingsProps) {
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (t: string) => {
    try {
      // Nothing is set before the first await on purpose: a synchronous setState from
      // inside the effect below would re-render before the effect finished.
      const { sessions: rows } = await api.sessions(t);
      setSessions(rows);
      setFailed(false);
    } catch {
      // A device list that cannot load is not an error worth a toast — the panel says so
      // in place and the rest of settings keeps working.
      setFailed(true);
    }
  }, []);

  // Written inline rather than `void load(token)`: the lint rule reads an effect body
  // that calls a setState-bearing function as a synchronous cascade, even when every
  // write is behind an await. Same reason AiResult keeps its request inside the effect.
  useEffect(() => {
    if (!token) return;
    let live = true;
    void (async () => {
      try {
        const { sessions: rows } = await api.sessions(token);
        if (!live) return;
        setSessions(rows);
        setFailed(false);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => { live = false; };
  }, [token]);

  // Signed out there are no devices to list, and the sync section above already explains
  // what an account is for. A second empty promise here would be clutter.
  if (!email || !token) return null;

  const revoke = async (s: DeviceSession) => {
    try {
      await api.revokeSession(token, s.id);
    } catch {
      setFailed(true);
      return;
    }
    // Revoking the device in hand invalidated the token that was just used — the only
    // honest thing left is to sign out locally. Notes stay, as always.
    if (s.current) return onSignOut();
    void load(token);
  };

  const revokeOthers = async () => {
    try {
      await api.revokeOtherSessions(token);
    } catch {
      setFailed(true);
      return;
    }
    void load(token);
  };

  return (
    <Section title="دستگاه‌های واردشده">
      {failed && (
        <p className="mb-2 text-xs leading-relaxed text-destructive">
          فهرست دستگاه‌ها در دسترس نیست.
        </p>
      )}
      {sessions === null && !failed && (
        <p className="text-xs text-muted">در حال بارگذاری…</p>
      )}

      {sessions?.map(s => (
        <Field
          key={s.id}
          label={deviceLabel(s.userAgent) + (s.current ? ' — همین دستگاه' : '')}
          // An absolute date, not «۳ روز پیش»: on a security list, vague is worse.
          description={`آخرین فعالیت: ${new Date(s.lastSeenAt).toLocaleDateString('fa-IR')}`}
        >
          <ConfirmButton
            label="خروج"
            confirmLabel={s.current ? 'خروج از این دستگاه؟' : 'مطمئنید؟'}
            onConfirm={() => void revoke(s)}
          />
        </Field>
      ))}

      {sessions && sessions.length > 1 && (
        <Field label="بقیهٔ دستگاه‌ها" description="این دستگاه وارد می‌ماند.">
          <ConfirmButton
            label="خروج از بقیه"
            confirmLabel="مطمئنید؟"
            onConfirm={() => void revokeOthers()}
          />
        </Field>
      )}
    </Section>
  );
}

/**
 * Absent unless `/auth/me` says so. The server refuses `/admin/*` to everyone else
 * regardless — this is the convenience half of that gate, not the gate.
 */
function AdminSection({ token, isAdmin }: SettingsProps) {
  if (!token || !isAdmin) return null;
  return (
    <Section title="مدیریت کاربران">
      <AdminPanel token={token} />
    </Section>
  );
}

function AiSection({ settings, onUpdateAi, email, tier, onSignIn }: SettingsProps) {
  const [cacheCount, setCacheCount] = useState(aiCacheSize);
  const direct = settings.ai.mode === 'direct';

  return (
    <Section title="هوش مصنوعی">
      <Field
        label="روش اتصال"
        description={direct
          ? 'کلید شما فقط روی همین دستگاه ذخیره می‌شود و مستقیم به سرویس ارسال می‌شود.'
          : 'کلید روی سرور می‌ماند و نیاز به حساب دارد.'}
      >
        <SegmentedControl
          options={AI_MODES}
          value={settings.ai.mode}
          onChange={mode => onUpdateAi({ mode })}
          label="روش اتصال"
        />
      </Field>

      {!direct && !email && (
        <Field label="حساب" description="حالت «سرور» به حساب نیاز دارد.">
          <Button variant="primary" size="sm" onClick={onSignIn}>ورود</Button>
        </Field>
      )}

      {/* Signed in but not upgraded: an explanation, not controls that cannot work.
          «مستقیم» is right there in the switch above and needs nothing from us. */}
      {!direct && email && tier !== 'pro' && (
        <Field
          label="حساب"
          description="حالت «سرور» برای حساب شما فعال نیست. می‌توانید از حالت «مستقیم» با کلید خودتان استفاده کنید."
        >
          <span className="text-xs text-muted">حساب ارتقا نیافته</span>
        </Field>
      )}

      {direct && (
        <>
          <Field label="آدرس سرویس" htmlFor="ai-url">
            <input
              id="ai-url"
              value={settings.ai.baseUrl}
              onChange={e => onUpdateAi({ baseUrl: e.target.value })}
              dir="ltr"
              className={AI_INPUT}
            />
          </Field>
          <Field label="مدل" htmlFor="ai-model">
            <input
              id="ai-model"
              value={settings.ai.model}
              onChange={e => onUpdateAi({ model: e.target.value })}
              dir="ltr"
              className={AI_INPUT}
            />
          </Field>
          <Field
            label="کلید"
            htmlFor="ai-key"
            description="در این مرورگر ذخیره می‌شود و همگام‌سازی نمی‌شود."
          >
            <input
              id="ai-key"
              type="password"
              value={settings.ai.apiKey ?? ''}
              onChange={e => onUpdateAi({ apiKey: e.target.value || null })}
              dir="ltr"
              autoComplete="off"
              className={AI_INPUT}
            />
          </Field>
        </>
      )}

      <Field label="زبان مقصد ترجمه">
        <Select
          options={TARGET_LANGS}
          value={settings.ai.targetLang}
          onChange={targetLang => onUpdateAi({ targetLang })}
          label="زبان مقصد ترجمه"
        />
      </Field>

      <Field
        label="حافظهٔ پاسخ‌ها"
        description={`${cacheCount} پاسخ ذخیره شده؛ درخواست تکراری دوباره ارسال نمی‌شود.`}
      >
        <div className="flex items-center gap-2">
          <Switch
            checked={settings.ai.cache}
            onChange={cache => onUpdateAi({ cache })}
            label="فعال بودن حافظهٔ پاسخ‌ها"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { clearAiCache(); setCacheCount(0); }}
          >
            پاک کردن
          </Button>
        </div>
      </Field>
    </Section>
  );
}
