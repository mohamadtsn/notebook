import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { springUI } from '../../lib/motion';

/** Keeps the menu off the viewport edge. */
const MARGIN = 8;

/**
 * DESIGN.md §6 "Context menu". Anchored to a point rather than to a trigger, which is
 * why this is not a Popover prop: Popover positions itself against its own anchor box.
 */
export function ContextMenu({
  x, y, onClose, autoFocus = false, alignEnd = false, minWidth, children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  /**
   * Treat `x` as the menu's inline-end edge instead of its start. A menu dropped under a
   * control should line up with that control's edge; a pointer menu grows from the point.
   */
  alignEnd?: boolean;
  /** Match a trigger's width, so the list is not narrower than the thing it belongs to. */
  minWidth?: number;
  /**
   * Only for keyboard-opened menus. A pointer-opened menu must NOT take focus: the
   * browser stops painting a textarea's selection the moment it blurs, so stealing
   * focus makes the highlighted text the user just right-clicked appear unselected.
   * Arrow keys still work without it — the handler below focuses the first item.
   */
  autoFocus?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, origin: 'top left' });

  // Flip before paint, not after: a menu that visibly jumps into place reads as a bug.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsetWidth/Height, not getBoundingClientRect: the enter animation scales the
    // element, and a rect measured mid-scale clamps against a box smaller than the
    // final one — which let the menu settle past the bottom edge.
    const { offsetWidth: width, offsetHeight: height } = el;
    const wanted = alignEnd ? x - width : x;
    const left = Math.max(MARGIN, Math.min(wanted, window.innerWidth - width - MARGIN));
    const top = Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN));
    // Scale from the corner nearest the pointer, so the menu grows out of the click
    // rather than sliding toward it.
    setPos({
      left,
      top,
      origin: `${top < y ? 'bottom' : 'top'} ${left < x ? 'right' : 'left'}`,
    });
  }, [x, y, alignEnd]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      const el = ref.current;
      if (!el) return;
      const items = [...el.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (items.length === 0) return;
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      if (e.key === 'Home')      { e.preventDefault(); items[0].focus(); }
      if (e.key === 'End')       { e.preventDefault(); items[items.length - 1].focus(); }
    };

    document.addEventListener('pointerdown', onPointerDown);
    // Capture: the editor's own Escape/arrow handling must not run while a menu is open.
    document.addEventListener('keydown', onKeyDown, true);
    if (autoFocus) ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose, autoFocus]);

  /**
   * Portalled to <body> deliberately. `position: fixed` is resolved against the nearest
   * ancestor with a transform, not the viewport — and every panel this menu opens over is
   * animated with one (motion's scale/translate). Rendered in place, the clamped
   * coordinates were being re-based onto the panel and the list ran off the screen.
   */
  return createPortal(
    <motion.div
      ref={ref}
      role="menu"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={springUI}
      style={{ left: pos.left, top: pos.top, transformOrigin: pos.origin, minWidth }}
      // Keeps focus (and therefore the painted selection) where it was; the click
      // still fires, so the items work exactly as before.
      onMouseDown={e => e.preventDefault()}
      // Solid, not glass: it opens over the editor sheet and small dense text needs an
      // opaque backing — DESIGN.md §2.
      className="fixed z-50 min-w-52 rounded-lg border border-separator bg-surface p-1 shadow-e2"
    >
      {children}
    </motion.div>,
    document.body,
  );
}
