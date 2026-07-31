import { useCallback, useRef, useState } from 'react';

import { capturePointer, releasePointer } from '../../conversations/pointer-capture.js';

/**
 * Drag a message sideways to reply to it.
 *
 * The gesture every messaging app converged on, and for a good reason: reply is
 * the most frequent action on a message by a wide margin, and routing the most
 * frequent action through a 500 ms hold and a menu makes the common case the
 * slow one. A swipe is direct - the message moves under the finger and springs
 * back, so the affordance teaches itself the first time a thumb brushes it.
 *
 * ## Why this is not gated to touch
 *
 * docs/13 § 4.5: one behaviour, several entry points, never a mobile branch and
 * a desktop branch. Pointer events cover mouse, touch and pen with the same
 * code, so a trackpad drag does the same thing - it just is not how anyone on a
 * desktop will reach for it, because the hover `⋯` is closer to hand there.
 *
 * ## Why it does not fight the scroller
 *
 * A thread scrolls vertically and this gesture is horizontal, so the two are
 * separated by direction rather than by timing. Nothing moves until the pointer
 * has travelled far enough to prove intent *and* is travelling more sideways
 * than up - before that the browser keeps the scroll, and after it we take the
 * pointer with `setPointerCapture` so a fast flick cannot escape mid-drag.
 */

/**
 * How far the message follows the finger before the gesture commits, in px.
 *
 * Past this the reply happens on release. The message keeps moving after it,
 * with heavy resistance, so the finger is told "yes, that is enough" by feel
 * rather than by the motion simply stopping.
 */
const COMMIT_PX = 56;

/** How far the pointer must travel before we decide this is a swipe at all. */
const ENGAGE_PX = 12;

/** Past the commit point, the message moves this fraction of the finger. */
const RESISTANCE = 0.25;

/** Hard stop, so a long drag cannot pull a bubble across the thread. */
const MAX_PX = 84;

export interface SwipeToReply {
  /** Spread onto the element that should follow the finger. */
  handlers: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
    onPointerCancel: (event: React.PointerEvent) => void;
  };
  /** Current horizontal offset, in px. Zero when idle. */
  offset: number;
  /** True once far enough that releasing would reply. Drives the icon state. */
  armed: boolean;
  /** True while the finger is down and the gesture has engaged. */
  dragging: boolean;
}

/**
 * @param onReply Fired on release, past the commit distance. Never fired mid-drag,
 * because a gesture you cannot abandon by dragging back is a trap.
 * @param enabled Off for messages there is nothing to reply to, such as a
 * tombstone - the affordance should not appear where the action does not exist.
 */
export function useSwipeToReply(
  onReply: () => void,
  enabled = true,
  /**
   * Which way the message travels: `1` for right, `-1` for left.
   *
   * Your own messages sit against the right edge of the thread and swipe left;
   * theirs sit against the left and swipe right. Both move *inward*, away from
   * the edge they are already pressed against - a bubble dragged further into
   * the margin it is already touching has nowhere to go and reads as stuck.
   */
  direction: 1 | -1 = 1,
): SwipeToReply {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  /** Undecided until the pointer has moved enough to be one thing or the other. */
  const engaged = useRef(false);

  const reset = useCallback(() => {
    start.current = undefined;
    engaged.current = false;
    setDragging(false);
    setOffset(0);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled || event.button !== 0) return;
      start.current = { x: event.clientX, y: event.clientY };
      engaged.current = false;
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const origin = start.current;
      if (!origin) return;

      // Measured along the allowed direction, so everything below is a plain
      // "how far has it come" regardless of which way that is on screen.
      const travelled = (event.clientX - origin.x) * direction;
      const dy = event.clientY - origin.y;

      if (!engaged.current) {
        // Not far enough to mean anything yet.
        if (Math.abs(travelled) < ENGAGE_PX && Math.abs(dy) < ENGAGE_PX) return;

        /*
         * Direction decides who owns this pointer, and the decision is made
         * once. A drag that started vertically stays the scroller's for its
         * whole life, even if it curves - otherwise a diagonal flick would hand
         * the thread over mid-scroll. A drag the wrong way is not this gesture
         * either, and is dropped rather than clamped to zero, so it cannot
         * become a swipe by curving back.
         */
        if (Math.abs(travelled) <= Math.abs(dy) || travelled <= 0) {
          start.current = undefined;
          return;
        }

        engaged.current = true;
        setDragging(true);
        // The bubble keeps the pointer from here on, so a flick that leaves the
        // element does not strand it mid-swipe with no release to reset it.
        capturePointer(event.currentTarget as HTMLElement, event.pointerId);
      }

      // Free travel up to the commit point, then heavy resistance: the message
      // still answers the finger, but says it has gone far enough.
      const eased =
        travelled <= COMMIT_PX
          ? travelled
          : COMMIT_PX + (travelled - COMMIT_PX) * RESISTANCE;
      setOffset(Math.min(eased, MAX_PX));
    },
    [direction],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const committed = engaged.current && offset >= COMMIT_PX;
      releasePointer(event.currentTarget as HTMLElement, event.pointerId);
      reset();

      if (committed) {
        // docs/13 § 5: the confirming tap lands when the action does, not when
        // the finger crossed the line.
        navigator.vibrate?.(6);
        onReply();
      }
    },
    [offset, onReply, reset],
  );

  const onPointerCancel = useCallback(
    (event: React.PointerEvent) => {
      releasePointer(event.currentTarget as HTMLElement, event.pointerId);
      reset();
    },
    [reset],
  );

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    offset,
    armed: offset >= COMMIT_PX,
    dragging,
  };
}
