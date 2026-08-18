import type { ReactNode } from 'react';

/**
 * DESIGN.md §6 "Settings row". Label and description on the inline-start, control on
 * the inline-end. 44px min height comes from the touch-target floor (§8), not from taste.
 */
export function Field({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 border-b border-separator py-3 last:border-b-0">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-sm text-ink">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
