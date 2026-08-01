import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { Tooltip } from './Tooltip';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: this control has no visible text. DESIGN.md §8. */
  label: string;
  active?: boolean;
  tone?: 'default' | 'danger';
  children: ReactNode;
}

/**
 * 36×36 visual, 44×44 hit area via the ::after pad — DESIGN.md §4.
 * The pad is why the icon can stay small without failing the touch-target floor.
 */
export function IconButton({
  label,
  active = false,
  tone = 'default',
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    // Tooltip replaces the native `title`: the OS one is slow, unstyled, and
    // can't skip its delay for the next button in the row.
    <Tooltip label={label}>
    <button
      {...rest}
      aria-label={label}
      aria-pressed={rest['aria-pressed'] ?? (active || undefined)}
      className={cx(
        'relative inline-flex size-9 items-center justify-center rounded-md',
        'after:absolute after:-inset-1 after:content-[""]',
        'transition-[transform,color,background-color] duration-(--d-press) ease-out-strong',
        'active:scale-[.94] disabled:opacity-50 disabled:pointer-events-none',
        tone === 'danger'
          ? 'text-muted hover:text-destructive hover:bg-destructive/10'
          : active
            ? 'text-accent bg-accent-soft'
            : 'text-muted hover:text-ink hover:bg-accent-soft',
        className,
      )}
    >
      {children}
    </button>
    </Tooltip>
  );
}