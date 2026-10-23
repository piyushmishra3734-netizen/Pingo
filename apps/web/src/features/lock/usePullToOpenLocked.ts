import { useEffect, useRef, useState, type RefObject } from 'react';

import { OPEN_AT, PullGesture } from './pull-gesture.js';

/**
 * Pull the chat list down from its top to open Locked chats, the way WhatsApp does.
 *
 * Only while something is locked: with nothing locked there is nothing to open,
 * and a list that gives no sign of a locked folder gives none by pulling either.
 * The gesture itself is `PullGesture`; this wires it to touch events and hands
 * the pull back so the list can make room for it. What opens is the PIN pad, not
 * the chats. The browser's own pull-to-refresh is held off while the pull is ours.
 */
export function usePullToOpenLocked(
  scroller: RefObject<HTMLElement | null>,
  enabled: boolean,
  onOpen: () => void,
): { pull: number; armed: boolean } {
  const [pull, setPull] = useState(0);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    const el = scroller.current;
    if (!el || !enabled) {
      setPull(0);
      return;
    }
    const gesture = new PullGesture();

    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      gesture.start(event.touches.length, touch?.clientX ?? 0, touch?.clientY ?? 0, el.scrollTop);
    };
    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      const step = gesture.move(touch.clientX, touch.clientY, el.scrollTop);
      setPull(step.pull);
      // A small tick as it becomes "enough", once per pull.
      if (step.justArmed) navigator.vibrate?.(8);
      if (step.consume && event.cancelable) event.preventDefault();
    };
    const end = () => {
      const open = gesture.end();
      setPull(0);
      if (open) openRef.current();
    };
    const cancel = () => {
      gesture.reset();
      setPull(0);
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', cancel);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', cancel);
      setPull(0);
    };
  }, [scroller, enabled]);

  return { pull, armed: pull >= OPEN_AT };
}
