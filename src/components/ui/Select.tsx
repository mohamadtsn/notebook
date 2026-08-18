import { useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { ContextMenu } from './ContextMenu';
import { PopoverItem } from './Popover';
import { cx } from './cx';

interface SelectProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Required: the trigger shows the current value, not what it selects. DESIGN.md §8. */
  label: string;
  className?: string;
}

/**
 * DESIGN.md §6. A native `<select>` renders as an OS widget that ignores every token in
 * the design system — wrong font, wrong radius, wrong popup, and a light dropdown on a
 * dark page. This is the project's own control.
 *
 * Built on ContextMenu, NOT on Popover: Popover positions itself `absolute` inside its
 * parent, and every place a select appears here (the settings panel) is a scroll
 * container, which clipped the list. ContextMenu is `position: fixed` and already flips
 * at the viewport edge, so the list is always whole. Arrow keys and Escape come with it.
 *
 * Trade-off, stated: the native element brings type-ahead and the platform's mobile
 * picker for free, and this does not. Both are worth less here than a control that
 * matches the app.
 */
export function Select<T extends string>({
  options, value, onChange, label, className,
}: SelectProps<T>) {
  const ref = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number; width: number } | null>(null);
  const current = options.find(o => o.value === value);

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // The list hangs from the trigger's own inline-end edge (RTL), 4px below it.
    setAt({ x: r.right, y: r.bottom + 4, width: r.width });
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => (at ? setAt(null) : open())}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={at !== null}
        className={cx(
          'flex min-h-11 items-center gap-2 rounded-lg border bg-fill px-3 text-sm text-ink',
          'transition-colors duration-(--d-fast)',
          at ? 'border-accent' : 'border-separator hover:border-accent/40',
          className,
        )}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown
          size={14}
          className={cx(
            'shrink-0 text-muted transition-transform duration-(--d-fast)',
            at && 'rotate-180',
          )}
        />
      </button>

      {at && (
        <ContextMenu
          x={at.x}
          y={at.y}
          alignEnd
          minWidth={at.width}
          autoFocus
          onClose={() => { setAt(null); ref.current?.focus(); }}
        >
          <div role="listbox" aria-label={label}>
            {options.map(o => (
              <PopoverItem key={o.value} onClick={() => { onChange(o.value); setAt(null); }}>
                <span className="flex-1 truncate">{o.label}</span>
                {o.value === value && <Check size={13} className="shrink-0 text-accent" />}
              </PopoverItem>
            ))}
          </div>
        </ContextMenu>
      )}
    </>
  );
}
