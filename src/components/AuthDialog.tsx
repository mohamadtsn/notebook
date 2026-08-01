import { useState, type SubmitEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { ApiError } from '../utils/api';
import { easeOut, springUI } from '../lib/motion';
import { Button } from './ui/Button';

type Mode = 'login' | 'register';

interface AuthDialogProps {
  onClose: () => void;
  onSubmit: (mode: Mode, email: string, password: string) => Promise<void>;
}

const TITLE: Record<Mode, string> = {
  login: 'ورود به حساب',
  register: 'ساخت حساب',
};

/** Server-side failures the user can actually act on. Anything else is a network problem. */
function messageFor(err: unknown): string {
  if (!(err instanceof ApiError)) return 'اتصال به سرور برقرار نشد.';
  if (err.status === 401) return 'ایمیل یا رمز عبور درست نیست.';
  if (err.status === 409) return 'این ایمیل قبلاً ثبت شده است.';
  if (err.status === 429) return 'تلاش‌های زیاد. کمی بعد دوباره امتحان کنید.';
  if (err.status === 400) return 'ایمیل نامعتبر یا رمز عبور کوتاه‌تر از ۸ نویسه است.';
  return 'خطایی رخ داد. دوباره تلاش کنید.';
}

export function AuthDialog({ onClose, onSubmit }: AuthDialogProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(mode, email.trim(), password);
      onClose();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  // Filled field, hairline only on focus: a box per input turned the form into a
  // grid of rectangles. The fill is the affordance, the accent ring is the state.
  const field = [
    'w-full rounded-lg bg-fill px-3 py-2.5',
    'text-sm text-ink outline-none ring-1 ring-transparent',
    'transition-[background-color,box-shadow] duration-[var(--d-fast)] ease-[var(--ease-out-strong)]',
    // The ring follows the field's own rounding, plus a soft halo instead of a
    // hard offset outline — DESIGN.md §8.
    'focus:bg-surface focus:ring-2 focus:ring-accent focus:shadow-[0_0_0_4px_var(--accent-soft)]',
  ].join(' ');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="scrim fixed inset-0 z-50 flex items-start justify-center p-4 pt-[14vh]"
      onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.form
        role="dialog"
        aria-modal="true"
        aria-label={TITLE[mode]}
        onSubmit={submit}
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
        // A modal isn't anchored to a trigger, so it stays centred — it only
        // materialises: scale + a short drop. DESIGN.md §5.
        initial={{ opacity: 0, scale: 0.96, y: -12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -8 }}
        transition={springUI}
        className="glass-overlay w-full max-w-sm rounded-2xl p-5"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.h2
            key={mode}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: easeOut }}
            className="mb-1 text-base font-semibold text-ink"
          >
            {TITLE[mode]}
          </motion.h2>
        </AnimatePresence>
        <p className="mb-4 text-xs text-muted">
          همگام‌سازی اختیاری است؛ بدون حساب هم همه‌چیز روی همین دستگاه کار می‌کند.
        </p>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-ink-soft">ایمیل</span>
          <input
            autoFocus
            type="email"
            required
            dir="ltr"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className={field}
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-xs text-ink-soft">رمز عبور</span>
          <input
            type="password"
            required
            minLength={8}
            dir="ltr"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className={field}
          />
        </label>

        <AnimatePresence initial={false}>
          {error && (
            <motion.p
              role="alert"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: easeOut }}
              className="overflow-hidden text-xs text-destructive"
            >
              <span className="mb-3 block pt-1">{error}</span>
            </motion.p>
          )}
        </AnimatePresence>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => { setMode(m => (m === 'login' ? 'register' : 'login')); setError(null); }}
            className="rounded-md px-1 py-1 text-xs text-accent transition-transform duration-[var(--d-press)] ease-[var(--ease-out-strong)] hover:underline active:scale-[.97]"
          >
            {mode === 'login' ? 'حساب ندارم' : 'قبلاً ثبت‌نام کرده‌ام'}
          </button>
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? 'کمی صبر کنید…' : TITLE[mode]}
          </Button>
        </div>
      </motion.form>
    </motion.div>
  );
}