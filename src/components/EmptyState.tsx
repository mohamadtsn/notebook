import { motion } from 'motion/react';
import { easeOut } from '../lib/motion';
import { Button } from './ui/Button';

interface EmptyStateProps {
  onNewNote?: () => void;
}

export function EmptyState({ onNewNote }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: easeOut }}
      className="flex h-full flex-col items-center justify-center p-8 text-center"
    >
      <h2 className="mb-1.5 text-lg font-medium tracking-[-0.01em] text-ink">
        یادداشتی انتخاب نشده
      </h2>
      <p className="mb-6 max-w-xs text-sm leading-relaxed text-muted">
        یکی از یادداشت‌های فهرست را باز کنید
        {onNewNote ? ' یا یادداشت تازه‌ای بسازید.' : ' یا یادداشتی را از سطل زباله بازگردانید.'}
      </p>
      {onNewNote && (
        <Button variant="primary" onClick={onNewNote}>
          یادداشت جدید
        </Button>
      )}
    </motion.div>
  );
}
