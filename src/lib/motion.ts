import type { Transition } from 'motion/react';

/** Motion tokens — DESIGN.md §5. Import these; never inline spring numbers. */

/** Default for anything the user can't fling. No overshoot. */
export const springUI: Transition = { type: 'spring', bounce: 0, duration: 0.35 };

/** Only for momentum: drag release, sheets. Overshoot is earned by the gesture. */
export const springDrag: Transition = { type: 'spring', bounce: 0.2, duration: 0.4 };

export const easeOut = [0.23, 1, 0.32, 1] as const;
export const easeInOut = [0.77, 0, 0.175, 1] as const;
export const easeDrawer = [0.32, 0.72, 0, 1] as const;

/** Enter/exit pair for panels and popovers. Never scale from 0 — DESIGN.md §5. */
export const popIn = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
  transition: springUI,
};