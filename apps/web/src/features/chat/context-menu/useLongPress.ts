import { useCallback, useRef } from 'react';

/**
 * Long press, per docs/13 § 6: recognised at 120 ms.
 *
 * ## Why not a library
 *
 * The whole behaviour is three listeners and a timer. What matters is the
 * cancellation rules, and those are product decisions rather than generic ones:
 * a press that starts to move is a scroll, and a scroll is the user changing
 * their mind (docs/13 § 2.3).
 *
 * ## The context menu is not a browser context menu
 *
 * A long press on touch also fires the platform's own text-selection and
 * callout UI, which would sit on top of ours. Suppressing it is why
 * `onContextMenu` is part of the returned handlers rather than an afterthought.
 */

/**
 * How long a finger must rest. docs/13 § 6.
 *
 * 500ms, matching iMessage and Instagram. The doc originally said 120ms, which
 * was the *recognition latency* budget rather than the hold - at 120ms every
 * ordinary tap opens the menu. Past about a second users assume the gesture
 * failed and lift off, so the window is narrower than it looks.
 */
const PRESS_MS = 500;

/**
 * How far a finger may drift and still count as a press.
 *
 * Ten pixels, because a thumb resting on glass is never perfectly still, and a
 * threshold of zero turns every long press on a phone into a cancelled one.
 */
const MOVE_TOLERANCE_PX = 10;

export interface LongPressHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

/**
 * @param onLongPress Given the point the finger was on - docs/13 § 2.3 anchors
 * to the touch point for messages taller than the viewport, so the coordinate
 * has to survive, not just the fact of the press.
 */
export function useLongPress(
  onLongPress: (point: { x: number; y: number }) => void,
): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    origin.current = undefined;
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Secondary buttons already have their own menu on desktop.
      if (event.button !== 0) return;

      const point = { x: event.clientX, y: event.clientY };
      origin.current = point;

      timer.current = setTimeout(() => {
        timer.current = undefined;
        /*
         * Soft impact on recognition. docs/13 § 5 - the hand should know the
         * press landed before the eyes do, which is most of why a long press
         * feels responsive rather than slow.
         */
        navigator.vibrate?.(8);
        onLongPress(point);
      }, PRESS_MS);
    },
    [onLongPress],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const start = origin.current;
      if (!start || !timer.current) return;

      const drift = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (drift > MOVE_TOLERANCE_PX) cancel();
    },
    [cancel],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // Right-click and the touch callout both land here; ours replaces both.
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  };
}
