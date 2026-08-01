import { useId } from 'react';
import { motion } from 'motion/react';
import { springUI } from '../../lib/motion';
import { cx } from './cx';

interface Option<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

/**
 * DESIGN.md §6. The thumb is a shared layout element, so it springs between
 * segments instead of the track animating width — transform only.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  const thumbId = useId();

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(
        'relative inline-flex items-center gap-0.5 rounded-full p-0.5',
        'bg-fill',
        className,
      )}
    >
      {options.map(opt => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cx(
              'relative z-10 h-8 rounded-full px-3.5 text-xs font-medium',
              'transition-colors duration-[var(--d-fast)]',
              selected ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {selected && (
              <motion.span
                layoutId={thumbId}
                transition={springUI}
                className="absolute inset-0 -z-10 rounded-full bg-surface shadow-e1"
              />
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
