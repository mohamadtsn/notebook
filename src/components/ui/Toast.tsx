import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { springUI } from '../../lib/motion';
import { ToastContext, type ToastAction, type ToastContextValue } from './toast-context';

interface Toast {
  id: number;
  message: string;
  action?: ToastAction;
}

const DEFAULT_DURATION = 6000;

/**
 * DESIGN.md §6. Undo toast — this is what replaces confirm dialogs for
 * reversible destructive actions.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue['toast']>((message, options) => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, message, action: options?.action }]);

    const duration = options?.duration ?? DEFAULT_DURATION;
    if (duration > 0) setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        aria-live="polite"
        // Top-anchored: closer to the eye and clear of the thumb. Cleared past
        // the navbar so it reads as floating over the app, not part of it.
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col-reverse items-center gap-2 p-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + var(--chrome-inset) + var(--shell-gap))' }}
      >
        <AnimatePresence initial={false}>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              layout
              // Enters and exits along the same path — DESIGN.md §5.
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.96 }}
              transition={springUI}
              className="glass-panel pointer-events-auto flex items-center gap-3 rounded-xl py-2 ps-4 pe-2 text-sm text-ink"
            >
              <span>{t.message}</span>
              {t.action && (
                <button
                  onClick={() => { t.action!.onClick(); dismiss(t.id); }}
                  className="rounded-md px-2 py-1 text-xs font-medium text-accent transition-[transform,background-color] duration-[var(--d-press)] hover:bg-accent-soft active:scale-[.97]"
                >
                  {t.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
