import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { springUI } from '../../lib/motion';
import { cx } from './cx';

interface PopoverProps {
  /** Rendered as the anchor. Receives the open state so it can show an active style. */
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  /** Which edge of the trigger the panel grows from. */
  side?: 'top' | 'bottom';
  className?: string;
}

/**
 * DESIGN.md §6. Scales from the trigger, not from center — the panel's
 * transform-origin is the edge it is anchored to.
 */
export function Popover({ trigger, children, side = 'bottom', className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The innermost open layer owns Escape. Capture phase plus stopPropagation is what
      // makes that true: a Popover inside the settings panel would otherwise close both,
      // because both listeners sit on `document` and the outer one registered first.
      e.stopPropagation();
      setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => setOpen(o => !o) })}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={springUI}
            style={{ transformOrigin: side === 'bottom' ? 'top center' : 'bottom center' }}
            className={cx(
              // Solid, not glass: the trigger often lives inside a glass surface and
              // stacking two translucent layers destroys legibility — DESIGN.md §2.
              'absolute z-30 min-w-40 rounded-lg border border-separator bg-surface p-1 shadow-e2',
              'end-0',
              side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
              className,
            )}
          >
            {children({ close: () => setOpen(false) })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Row inside a Popover. Text-start aligned so it reads correctly in both directions. */
export function PopoverItem({
  onClick,
  tone = 'default',
  children,
}: {
  onClick: () => void;
  tone?: 'default' | 'danger';
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-xs',
        'transition-colors duration-[var(--d-fast)]',
        tone === 'danger'
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-ink hover:bg-accent-soft',
      )}
    >
      {children}
    </button>
  );
}
