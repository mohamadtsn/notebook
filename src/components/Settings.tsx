import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { popIn } from '../lib/motion';
import { TARGET_LANGS } from '../utils/ai';
import { aiCacheSize, clearAiCache } from '../utils/aiCache';

interface SettingsProps {
  settings: SettingsValue;
  onUpdate: (patch: Partial<SettingsValue>) => void;
  onUpdateAi: (patch: Partial<AiSettings>) => void;
  email: string | null;
  syncState: SyncState;
  settingsState: SyncState;
  pending: number;
  onSync: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
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
  const { settings, onUpdate, onClose, instant } = props;
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
          </Section>

          {/* No «درباره» account row: the sync section already states the account state
              and offers the way in. A section that only promises is clutter. */}
          <SyncSection {...props} />
          <AiSection {...props} />
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

function AiSection({ settings, onUpdateAi, email, onSignIn }: SettingsProps) {
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
          <input
            type="checkbox"
            checked={settings.ai.cache}
            onChange={e => onUpdateAi({ cache: e.target.checked })}
            aria-label="فعال بودن حافظهٔ پاسخ‌ها"
            className="size-5 accent-[var(--accent)]"
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
