import { ChatIcon, cn } from '@pingo/ui';

import { useSwipeToReply } from './context-menu/useSwipeToReply.js';

/**
 * Wraps a message so dragging it sideways replies to it.
 *
 * A wrapper rather than more props on `MessageBubble`, for two reasons. The
 * bubble stays presentational, which is what lets the context menu render a
 * second copy of it without inheriting a live gesture. And pointer events
 * bubble, so the long press on the bubble and the swipe out here can both watch
 * the same pointer without either one having to know about the other — the long
 * press cancels itself at 10px of drift, the swipe engages at 12, and the
 * ordering falls out of that rather than out of coordination code.
 */

/** Where the icon is fully revealed. Matches the hook's commit distance. */
const COMMIT_PX = 56;

export interface SwipeableMessageProps {
  onReply: () => void;
  /** Which side of the thread this message is on, so the icon sits opposite it. */
  mine: boolean;
  /** Off where there is nothing to reply to — a tombstone, a failed send. */
  enabled?: boolean;
  children: React.ReactNode;
}

export function SwipeableMessage({
  onReply,
  mine,
  enabled = true,
  children,
}: SwipeableMessageProps) {
  const { handlers, offset, armed, dragging } = useSwipeToReply(onReply, enabled);

  /** 0 → 1 across the travel, so the icon arrives as the gesture does. */
  const progress = Math.min(offset / COMMIT_PX, 1);

  return (
    <div className="relative" {...handlers}>
      {/*
        The icon is revealed from underneath rather than pushed along in front:
        it belongs to the track the message slides over, not to the message.
      */}
      {offset > 0 && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 flex items-center',
            mine ? 'left-2' : 'left-0',
          )}
          style={{
            opacity: progress,
            transform: `scale(${0.7 + progress * 0.3})`,
          }}
        >
          <span
            className={cn(
              'grid size-8 place-items-center rounded-full',
              'transition-colors duration-instant',
              // Filling in at the commit point is the only signal a thumb gets
              // on a device with no haptics, so it has to be unmistakable.
              armed ? 'bg-brand text-white' : 'bg-hover text-text-secondary',
            )}
          >
            <ChatIcon size={16} />
          </span>
        </div>
      )}

      <div
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        className={cn(
          // Animated only on release: transitioning during the drag would put
          // the message behind the finger, which reads as lag.
          !dragging && 'transition-transform duration-quick ease-standard',
          // The thread owns vertical panning; this owns horizontal, and saying
          // so is what stops the browser from scrolling mid-swipe on touch.
          'touch-pan-y',
        )}
      >
        {children}
      </div>
    </div>
  );
}
