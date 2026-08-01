import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

/**
 * DESIGN.md §6. Radix owns the a11y wiring and the delay group: the first
 * tooltip waits, adjacent ones open instantly, which is what makes a toolbar
 * feel fast. The trigger keeps its own aria-label — the tooltip is a hint,
 * not the accessible name.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={400} skipDelayDuration={300}>
      {children}
    </RadixTooltip.Provider>
  );
}

interface TooltipProps {
  label: string;
  children: ReactNode;
}

export function Tooltip({ label, children }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          sideOffset={6}
          className={[
            'glass-overlay z-50 rounded-lg px-2 py-1 text-xs text-ink',
            // Scales from the trigger, never from 0 — DESIGN.md §5.
            'origin-(--radix-tooltip-content-transform-origin)',
            'data-[state=delayed-open]:animate-[tooltip-in_var(--d-fast)_var(--ease-out-strong)]',
          ].join(' ')}
        >
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}