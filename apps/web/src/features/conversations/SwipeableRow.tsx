import { cn } from '@pingo/ui';
import { useCallback, useRef, useState } from 'react';

import { capturePointer, releasePointer } from './pointer-capture.js';

/**
 * A conversation row you can swipe either way to act on.
 *
 * Two directions with different weights, which is the whole design: swiping
 * right is the reversible one — pin, unpin — and swiping left holds the ones
 * you might not want to do by accident. Both reveal their action from
 * underneath, so the row moving *is* the affordance and nothing has to be
 * labelled until it is already half-visible.
 *
 * ## Why one action per direction rather than a tray of them
 *
 * A tray of three buttons revealed by a swipe means a swipe, a look, an aim and
 * a tap — four steps for something a full swipe does in one. The extra actions
 * are not lost: they live in the long-press selection mode, which is the
 * surface built for choosing between many things.
 *
 * The long swipe commits directly. The short one springs back, so a swipe that
 * was really a mis-aimed scroll costs nothing.
 *
 * ## Shared vocabulary with the thread
 *
 * The engage distance, direction lock and pointer capture all match
 * `useSwipeToReply`, so a swipe on a chat row and a swipe on a message feel like
 * the same gesture rather than two implementations that happen to both move.
 */

/** Past this the action is armed and a release commits it. */
const COMMIT_PX = 72;

/** How far the pointer travels before this counts as a swipe at all. */
const ENGAGE_PX = 12;

/** Past the commit point the row moves this fraction of the finger. */
const RESISTANCE = 0.22;

/** Hard stop, so a long drag cannot pull a row clear across the screen. */
const MAX_PX = 104;

export interface SwipeAction {
  label: string;
  icon: React.ReactNode;
  /** Tailwind background for the revealed track. */
  tone: string;
  onAct: () => void;
}

export interface SwipeableRowProps {
  /** Revealed by swiping right. Absent means the row does not move that way. */
  right?: SwipeAction;
  /** Revealed by swiping left. */
  left?: SwipeAction;
  /** Off during selection mode, where a swipe would fight the tap target. */
  enabled?: boolean;
  children: React.ReactNode;
}

export function SwipeableRow({ right, left, enabled = true, children }: SwipeableRowProps) {
  /** Signed: positive is a rightward swipe, negative leftward. */
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const start = useRef<{ x: number; y: number } | undefined>(undefined);
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

      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;

      if (!engaged.current) {
        if (Math.abs(dx) < ENGAGE_PX && Math.abs(dy) < ENGAGE_PX) return;

        // Vertical wins ties, because the list scrolls and a chat row that
        // steals an ambiguous drag makes the whole screen feel like it grabs.
        if (Math.abs(dx) <= Math.abs(dy)) {
          start.current = undefined;
          return;
        }

        // Nothing to reveal that way — leave the pointer to the scroller.
        if ((dx > 0 && !right) || (dx < 0 && !left)) {
          start.current = undefined;
          return;
        }

        engaged.current = true;
        setDragging(true);
        capturePointer(event.currentTarget as HTMLElement, event.pointerId);
      }

      const magnitude = Math.abs(dx);
      const eased =
        magnitude <= COMMIT_PX
          ? magnitude
          : COMMIT_PX + (magnitude - COMMIT_PX) * RESISTANCE;

      setOffset(Math.sign(dx) * Math.min(eased, MAX_PX));
    },
    [right, left],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const action = offset > 0 ? right : left;
      const committed = engaged.current && Math.abs(offset) >= COMMIT_PX && action;

      releasePointer(event.currentTarget as HTMLElement, event.pointerId);
      reset();

      if (committed) {
        // Confirms when the action lands, not when the finger crossed the line.
        navigator.vibrate?.(8);
        action.onAct();
      }
    },
    [offset, right, left, reset],
  );

  const onPointerCancel = useCallback(
    (event: React.PointerEvent) => {
      releasePointer(event.currentTarget as HTMLElement, event.pointerId);
      reset();
    },
    [reset],
  );

  const action = offset > 0 ? right : offset < 0 ? left : undefined;
  const progress = Math.min(Math.abs(offset) / COMMIT_PX, 1);
  const armed = Math.abs(offset) >= COMMIT_PX;

  return (
    <div
      className="relative overflow-hidden rounded-lg"
      /*
       * Announced only once the gesture has committed to something.
       *
       * A live region that narrated every pixel of travel would talk over the
       * row itself. This says "Release to archive" at the moment releasing
       * would do that, which is the one instant the information is useful — and
       * it is the only way a screen-reader user gets told what a swipe is
       * about to do, since the revealed track is decorative.
       */
      aria-live="polite"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {action && (
        <div
          aria-hidden
          className={cn(
            'absolute inset-y-0 flex items-center px-4',
            offset > 0 ? 'left-0' : 'right-0',
            action.tone,
            // The whole track tints, so the colour reads before the icon does.
            'transition-opacity duration-instant',
          )}
          style={{ width: Math.abs(offset), opacity: 0.35 + progress * 0.65 }}
        >
          <span
            className={cn(
              'flex shrink-0 items-center gap-2 text-caption font-medium text-white',
              'transition-transform duration-instant',
            )}
            style={{ transform: `scale(${0.8 + progress * 0.2})` }}
          >
            {action.icon}
            {/* The label appears only once the gesture means something. */}
            {armed && <span className="whitespace-nowrap">{action.label}</span>}
          </span>
        </div>
      )}

      <div
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        className={cn(
          // Animated on release only; transitioning mid-drag reads as lag.
          !dragging && 'transition-transform duration-quick ease-standard',
          'relative touch-pan-y bg-page',
        )}
      >
        {children}
      </div>

      <span className="sr-only">{armed && action ? `Release to ${action.label}` : ''}</span>
    </div>
  );
}
