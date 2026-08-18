import { cx } from './cx';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  className?: string;
}

/**
 * DESIGN.md §6. A native `<input type=checkbox>` is drawn by the OS: `accent-color`
 * recolours the fill and leaves the shape, the size and the focus ring foreign to
 * everything around it. Same reasoning as `Select`.
 *
 * The thumb moves by `inset-inline-start` rather than a transform, so "on" is toward
 * the inline-end in RTL and LTR alike with no direction variant (§7).
 */
export function Switch({ checked, onChange, label, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-[26px] w-11 shrink-0 rounded-full transition-colors duration-(--d-fast)',
        // The 44px touch floor (§8) without a 44px-tall track.
        'after:absolute after:-inset-2.5 after:content-[""]',
        checked ? 'bg-accent' : 'bg-fill',
        className,
      )}
    >
      <span
        aria-hidden
        className={cx(
          'absolute top-0.5 size-[22px] rounded-full bg-surface shadow-e1',
          'transition-[inset-inline-start] duration-(--d-fast) ease-out-strong',
          checked ? 'start-[calc(100%-24px)]' : 'start-0.5',
        )}
      />
    </button>
  );
}
