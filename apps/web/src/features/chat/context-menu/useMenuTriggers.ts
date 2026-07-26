import { useCallback, useRef, useState } from 'react';

import { useLongPress } from './useLongPress.js';

/**
 * Every way of opening the message menu, in one place.
 *
 * docs/13 § 4.5: the component is one, only the trigger differs by platform,
 * and no behaviour differs with it. Two implementations would be two sets of
 * bugs — and the one that gets tested less is always the one people use more.
 *
 * | Platform | Trigger | Opens |
 * | --- | --- | --- |
 * | Touch | tap | reactions only |
 * | Touch | long press | everything |
 * | Pointer | the `⋯` that appears on hover | everything |
 * | Pointer | right-click, at the cursor | everything |
 * | Keyboard | `Shift+F10` or the Context Menu key | everything |
 *
 * ## Two depths, one menu
 *
 * Tapping a message offers the reaction bar and nothing else; holding it offers
 * the bar and the actions beneath. Reacting is by far the most common thing
 * anyone does to a message, and it is also the most reversible — so it gets the
 * cheapest gesture, and the half-second hold is reserved for the actions that
 * change something.
 *
 * This replaces double-tap-to-heart. The two cannot coexist: once a single tap
 * opens the bar, the second tap of a double tap lands on the bar rather than on
 * the message. Choosing which emoji is barely slower than committing to ❤️, and
 * it is one rule instead of two.
 *
 * ## Why tap-to-react is touch only
 *
 * A click is how you interact with everything on a desktop, so making it open a
 * reaction bar would fire constantly by accident. The hover `⋯` is already the
 * cheap opener there. Per § 4.5 this is a difference in *trigger*, which the
 * table above is for — the menu and its behaviour stay identical.
 *
 * ## Why right-click anchors to the cursor
 *
 * § 1.1 asks the menu to come from where the input was. On a finger that is the
 * bubble; on a mouse it is the pointer, because that is where the user is
 * already looking.
 */

/** How much of the menu an opener asked for. */
export type MenuMode = 'reactions' | 'full';

export interface MenuOpen {
  anchor: DOMRect;
  touch: { x: number; y: number };
  mode: MenuMode;
}

/**
 * How far a finger may travel and still count as a tap.
 *
 * Wider than the long press's own tolerance, because this is judged at release
 * over the whole gesture rather than continuously — and a tap that scrolled the
 * thread a little should not also open something.
 */
const TAP_SLOP_PX = 12;

export interface MenuTriggers {
  /** Present while the menu is open; the geometry it needs. */
  open: MenuOpen | undefined;
  close: () => void;
  /** Spread onto the message bubble. */
  handlers: {
    ref: (node: HTMLElement | null) => void;
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
    onPointerCancel: () => void;
    onContextMenu: (event: React.MouseEvent) => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    tabIndex: number;
  };
  /** For the hover `⋯`, which opens the menu anchored to the bubble. */
  openFromButton: () => void;
}

export function useMessageMenu(): MenuTriggers {
  const [open, setOpen] = useState<MenuOpen | undefined>();
  const element = useRef<HTMLElement | null>(null);

  const rect = () => element.current?.getBoundingClientRect();

  /** Opens anchored to the bubble, with the touch point at its centre. */
  const openAtBubble = useCallback((mode: MenuMode = 'full') => {
    const box = rect();
    if (!box) return;
    setOpen({
      anchor: box,
      touch: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      mode,
    });
  }, []);

  const openAt = useCallback(
    (point: { x: number; y: number }, mode: MenuMode = 'full') => {
      const box = rect();
      if (!box) return;
      setOpen({ anchor: box, touch: point, mode });
    },
    [],
  );

  /**
   * Where the pointer went down, and whether the hold already claimed it.
   *
   * A long press that fires must not also register as a tap when the finger
   * lifts, or holding a message would open the full menu and then immediately
   * replace it with the reaction bar.
   */
  const down = useRef<{ x: number; y: number } | undefined>(undefined);
  const claimed = useRef(false);

  const longPress = useLongPress((point) => {
    claimed.current = true;
    openAt(point, 'full');
  });

  return {
    open,
    close: useCallback(() => setOpen(undefined), []),
    openFromButton: () => openAtBubble('full'),
    handlers: {
      ref: (node) => {
        element.current = node;
      },
      ...longPress,
      onPointerDown: (event: React.PointerEvent) => {
        longPress.onPointerDown(event);
        down.current = { x: event.clientX, y: event.clientY };
        claimed.current = false;
      },
      onPointerUp: (event: React.PointerEvent) => {
        longPress.onPointerUp();

        const origin = down.current;
        down.current = undefined;

        // The hold already opened something, or this was a swipe or a scroll.
        if (claimed.current || !origin) return;
        if (event.pointerType === 'mouse') return;

        const drift = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
        if (drift > TAP_SLOP_PX) return;

        openAtBubble('reactions');
      },
      onContextMenu: (event: React.MouseEvent) => {
        // Replaces the browser menu on desktop and the callout on touch.
        event.preventDefault();
        openAt({ x: event.clientX, y: event.clientY }, 'full');
      },
      onKeyDown: (event: React.KeyboardEvent) => {
        /*
         * The two conventional openers. `ContextMenu` is the dedicated key on a
         * full-size keyboard; `Shift+F10` is what laptops without one use, and
         * what screen-reader users reach for.
         */
        const wants =
          event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
        if (!wants) return;
        event.preventDefault();
        openAtBubble('full');
      },
      /*
       * Focusable, so the keyboard openers can reach it at all. A message is
       * not a control, so it is in the tab order only as a target — nothing
       * about it activates on Enter.
       */
      tabIndex: 0,
    },
  };
}
