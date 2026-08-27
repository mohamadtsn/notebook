import { useCallback, useEffect, useRef } from 'react';

/** Matches the platform long-press timers (Chrome ~500ms, WebKit ~550ms). */
const DELAY_MS = 500;
/** A press that wanders further than this was a scroll, not a press. */
const SLOP_PX = 10;

/**
 * Long press → our own menu, for touch and pen only.
 *
 * **Why not `contextmenu`.** That event was the single trigger for both menus, and it is
 * unavailable on iOS: WebKit does not dispatch it for a long press, it runs its own
 * callout instead. A menu built on it can never open there at all. Pointer events are
 * dispatched by every engine.
 *
 * **Why the mouse is excluded.** Right-click already goes through `onContextMenu`, and a
 * mouse button held down for half a second would otherwise open the menu a second time,
 * at a moment the user did not ask for. Desktop behaviour has to stay byte-for-byte.
 *
 * Fires only if the pointer stayed within `SLOP_PX`; cancels on move, up, `pointercancel`
 * and scroll — a fling that starts on a row is a scroll, and not every engine emits
 * `pointercancel` for it.
 *
 * `onClickCapture` swallows the click that the browser synthesises when the finger lifts:
 * without it a long press would open the menu *and* whatever the element does on tap.
 */
export function useLongPress(fire: (x: number, y: number) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const fired = useRef(false);
  // Read through a ref so the handlers do not have to be memoised by the caller.
  const fireRef = useRef(fire);
  useEffect(() => { fireRef.current = fire; });

  // The scroll listener is torn down through an AbortController rather than a matching
  // removeEventListener, so `stop` does not have to close over itself to cancel it.
  const scroll = useRef<AbortController | null>(null);
  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    scroll.current?.abort();
    scroll.current = null;
  }, []);

  // A press pending when the row unmounts must not fire into a dead component.
  useEffect(() => stop, [stop]);

  return {
    onPointerDown(e: React.PointerEvent) {
      if (e.pointerType === 'mouse') return;
      stop();
      fired.current = false;
      const { clientX: x, clientY: y } = e;
      origin.current = { x, y };
      timer.current = setTimeout(() => {
        stop();
        fired.current = true;
        fireRef.current(x, y);
      }, DELAY_MS);
      // Capture: the scroll happens on an ancestor, not on the pressed element.
      scroll.current = new AbortController();
      window.addEventListener('scroll', stop, { capture: true, signal: scroll.current.signal });
    },
    onPointerMove(e: React.PointerEvent) {
      if (timer.current === null) return;
      if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > SLOP_PX) stop();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onClickCapture(e: React.MouseEvent) {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
