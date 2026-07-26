import { useCallback, useRef, useState } from 'react';

import { useLongPress } from './useLongPress.js';

/**
 * Every way of opening the message menu, in one place.
 *
 * docs/13 § 4.5: the component is one, only the trigger differs by platform,
 * and no behaviour differs with it. Two implementations would be two sets of
 * bugs — and the one that gets tested less is always the one people use more.
 *
 * | Platform | Trigger |
 * | --- | --- |
 * | Touch | long press |
 * | Pointer | the `⋯` that appears on hover |
 * | Pointer | right-click, at the cursor |
 * | Keyboard | `Shift+F10` or the Context Menu key |
 *
 * ## Why right-click anchors to the cursor
 *
 * § 1.1 asks the menu to come from where the input was. On a finger that is the
 * bubble; on a mouse it is the pointer, because that is where the user is
 * already looking.
 */

export interface MenuOpen {
  anchor: DOMRect;
  touch: { x: number; y: number };
}

export interface MenuTriggers {
  /** Present while the menu is open; the geometry it needs. */
  open: MenuOpen | undefined;
  close: () => void;
  /** Spread onto the message bubble. */
  handlers: {
    ref: (node: HTMLElement | null) => void;
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: () => void;
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
  const openAtBubble = useCallback(() => {
    const box = rect();
    if (!box) return;
    setOpen({
      anchor: box,
      touch: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    });
  }, []);

  const openAt = useCallback((point: { x: number; y: number }) => {
    const box = rect();
    if (!box) return;
    setOpen({ anchor: box, touch: point });
  }, []);

  const longPress = useLongPress(openAt);

  return {
    open,
    close: useCallback(() => setOpen(undefined), []),
    openFromButton: openAtBubble,
    handlers: {
      ref: (node) => {
        element.current = node;
      },
      ...longPress,
      onContextMenu: (event: React.MouseEvent) => {
        // Replaces the browser menu on desktop and the callout on touch.
        event.preventDefault();
        openAt({ x: event.clientX, y: event.clientY });
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
        openAtBubble();
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
