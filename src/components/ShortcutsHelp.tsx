import { useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { Field } from './ui/Field';
import { IconButton } from './ui/IconButton';
import { popIn } from '../lib/motion';

interface ShortcutsHelpProps {
  /** Drives the "turn it on first" note, not what is listed. See `experimental` below. */
  experimentalEditor: boolean;
  onClose: () => void;
  /** Opened by keyboard → no enter animation. DESIGN.md §5. */
  instant: boolean;
}

interface Shortcut {
  label: string;
  /** Rendered in an LTR row, in the order pressed, whatever the page direction. */
  keys: string[];
  /** Only live with «ادیتور پیشرفته» on. Marked, never hidden — see the note below. */
  experimental?: boolean;
}

const GENERAL: Shortcut[] = [
  { label: 'یادداشت جدید', keys: ['Ctrl', 'N'] },
  { label: 'جستجو و دستورها', keys: ['Ctrl', 'K'] },
  { label: 'تنظیمات', keys: ['Ctrl', ','] },
  { label: 'همین پنجره', keys: ['?'] },
  { label: 'بستن پنجره یا خروج از فیلد', keys: ['Esc'] },
];

const EDITOR: Shortcut[] = [
  { label: 'واگرد', keys: ['Ctrl', 'Z'] },
  { label: 'ازنو', keys: ['Ctrl', 'Shift', 'Z'] },
  { label: 'ازنو (جایگزین)', keys: ['Ctrl', 'Y'] },
  { label: 'منوی ویرایشگر', keys: ['Shift', 'F10'] },
  // Worth listing: it is the only way to reach Persian spellcheck, and nothing in the
  // interface hints that the app is deliberately staying out of the way here.
  { label: 'منوی خود مرورگر با راست‌کلیک (غلط‌یاب فارسی)', keys: ['Shift'] },
];

const ADVANCED: Shortcut[] = [
  { label: 'افزودن نشانگر با کلیک', keys: ['Alt'], experimental: true },
  { label: 'افزودن نشانگر با کلیک (جایگزین)', keys: ['Ctrl'], experimental: true },
  { label: 'انتخاب ستونی با کشیدن', keys: ['Shift', 'Alt'], experimental: true },
  { label: 'جمع کردن نشانگرها به یکی', keys: ['Esc'], experimental: true },
];

function Keys({ keys }: { keys: string[] }) {
  return (
    // LTR so the modifier reads first, the way every shortcut is written. Chips carry
    // key names only — a Persian verb here fell back out of the mono face and looked
    // broken, and «با کلیک» reads better in the label anyway.
    <span dir="ltr" className="flex items-center gap-1">
      {keys.map((k, i) => (
        <span key={k} className="flex items-center gap-1">
          {i > 0 && <span className="text-[.6875rem] text-muted">+</span>}
          <kbd className="rounded-md border border-separator bg-fill px-1.5 py-0.5 font-mono text-[.6875rem] leading-normal text-ink-soft">
            {k}
          </kbd>
        </span>
      ))}
    </span>
  );
}

function Group({ title, items, note }: { title: string; items: Shortcut[]; note?: ReactNode }) {
  return (
    <section className="border-b border-separator px-5 py-4 last:border-b-0">
      <h3 className="mb-1 text-[1.0625rem] font-semibold leading-[1.35] tracking-[-0.01em] text-ink">
        {title}
      </h3>
      {note}
      {items.map(s => (
        <Field key={s.label} label={s.label}>
          <Keys keys={s.keys} />
        </Field>
      ))}
    </section>
  );
}

/**
 * The advanced editor's bindings were discoverable only by reading `CodeEditor.tsx`.
 *
 * The advanced rows are listed even when the flag is off, with a line saying so: this
 * panel is also how someone finds out the flag is worth turning on. Hiding them would
 * make the feature invisible to exactly the person looking for it.
 */
export function ShortcutsHelp({ experimentalEditor, onClose, instant }: ShortcutsHelpProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Same as Settings: focus lands in the content, and Escape is owned here. The
  // `role="dialog"` below is what stops the global Escape from also closing the note.
  useEffect(() => {
    contentRef.current?.focus();
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
        aria-label="کلیدهای میان‌بر"
        {...(instant ? {} : popIn)}
        className="glass-overlay relative flex max-h-[min(80vh,44rem)] w-full max-w-[34rem] flex-col rounded-3xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-separator px-5 py-3">
          <h2 className="text-lg font-semibold text-ink">کلیدهای میان‌بر</h2>
          <IconButton label="بستن" onClick={onClose}>
            <X size={17} />
          </IconButton>
        </header>

        {/* Nothing here is focusable except the close button, so the scroller takes focus
            itself — otherwise the panel opens with focus still behind it, and arrow keys
            scroll the page instead of this list. `tabindex="-1"` is excluded from the
            global focus ring in index.css — it is a programmatic target, not a keyboard
            stop, and the ring framed the whole panel. */}
        <div
          ref={contentRef}
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          <Group title="عمومی" items={GENERAL} />
          <Group title="ویرایشگر" items={EDITOR} />
          <Group
            title="ادیتور پیشرفته"
            items={ADVANCED}
            note={
              !experimentalEditor ? (
                <p className="mb-1 text-xs leading-relaxed text-muted">
                  این‌ها فقط با روشن بودن «ادیتور پیشرفته» کار می‌کنند — در تنظیمات.
                </p>
              ) : undefined
            }
          />
        </div>
      </motion.div>
    </div>
  );
}
