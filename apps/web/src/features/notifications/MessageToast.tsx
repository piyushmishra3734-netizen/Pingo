import { Avatar, Badge, cn } from '@pingo/ui';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/**
 * One floating in-app message banner.
 *
 * ## Motion (Instagram-style cue, PINGO surface)
 *
 * - Enters by sliding **down** from above
 * - Leaves by sliding **up** the same path
 * - One at a time: the next banner only enters after this one has fully left
 *
 * ## Gestures (same idea as Instagram's in-app banner)
 *
 * - **Tap** → open that chat
 * - **Swipe up** → dismiss (stays gone - does not spring back)
 * - **Swipe down** → open that chat
 */

export type MessageToastMotion = 'enter' | 'update' | 'exit';

export interface MessageToastData {
  id: string;
  conversationId: string;
  title: string;
  preview: string;
  createdAt: number;
  senderName: string;
  senderId: string;
  senderAvatarUrl?: string;
  unreadCount: number;
  generation: number;
}

export interface MessageToastProps {
  toast: MessageToastData;
  motion?: MessageToastMotion;
  onOpen: (conversationId: string) => void;
  onDismiss: (id: string) => void;
  durationMs?: number;
  paused?: boolean;
  className?: string;
}

const DISMISS_MS = 3800;

/** Full slide-up leave - next banner waits for this to finish. */
const EXIT_MS = 320;

/**
 * Pause after the old banner has fully left, before the next slides down.
 * Reads as one cue finishing, then the next arriving - not a hard swap.
 */
const GAP_AFTER_EXIT_MS = 500;

/** Swipe-up past this → dismiss (does not snap back). */
const SWIPE_UP_DISMISS_PX = 28;
/** Swipe-down past this → open the chat. */
const SWIPE_DOWN_OPEN_PX = 36;
/** Movement within this is treated as a tap, not a drag. */
const TAP_SLOP_PX = 12;
/** How far the banner may be pulled while tracking the finger. */
const DRAG_UP_MAX = 140;
const DRAG_DOWN_MAX = 72;

export function MessageToast({
  toast,
  motion = 'enter',
  onOpen,
  onDismiss,
  durationMs = DISMISS_MS,
  paused = false,
  className,
}: MessageToastProps) {
  const exiting = motion === 'exit';
  const [hovering, setHovering] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const remainingRef = useRef(durationMs);
  const startedAtRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointerStartY = useRef<number | undefined>(undefined);
  const pointerStartTime = useRef(0);
  const dragYRef = useRef(0);
  /** True when pointer-up already handled open/dismiss - skip the synthetic click. */
  const gestureHandledRef = useRef(false);

  const dismiss = useCallback(() => {
    onDismiss(toast.id);
  }, [onDismiss, toast.id]);

  const open = useCallback(() => {
    onOpen(toast.conversationId);
  }, [onOpen, toast.conversationId]);

  useEffect(() => {
    remainingRef.current = durationMs;
    startedAtRef.current = Date.now();
  }, [toast.generation, durationMs]);

  useEffect(() => {
    if (exiting) return;

    const frozen = hovering || paused || dragging;
    if (frozen) {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
        remainingRef.current = Math.max(
          0,
          remainingRef.current - (Date.now() - startedAtRef.current),
        );
      }
      return;
    }

    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(dismiss, remainingRef.current);

    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
  }, [dismiss, dragging, exiting, hovering, paused, toast.generation]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (exiting) return;
    // Primary button only for mouse.
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    gestureHandledRef.current = false;
    pointerStartY.current = event.clientY;
    pointerStartTime.current = Date.now();
    dragYRef.current = 0;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerStartY.current === undefined) return;
    const delta = event.clientY - pointerStartY.current;
    // Follow the finger both ways: up to dismiss, down to open.
    const next = Math.max(-DRAG_UP_MAX, Math.min(DRAG_DOWN_MAX, delta));
    dragYRef.current = next;
    setDragY(next);
  };

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerStartY.current === undefined) return;

    const delta = dragYRef.current;
    const elapsed = Math.max(1, Date.now() - pointerStartTime.current);
    const velocity = delta / elapsed; // px/ms, negative = flick up

    pointerStartY.current = undefined;
    setDragging(false);

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }

    // Tap: almost no movement.
    if (Math.abs(delta) < TAP_SLOP_PX) {
      gestureHandledRef.current = true;
      dragYRef.current = 0;
      setDragY(0);
      open();
      return;
    }

    // Swipe / flick up → dismiss and stay dismissed (no spring-back).
    const flickedUp = velocity < -0.35 && delta < -12;
    if (delta <= -SWIPE_UP_DISMISS_PX || flickedUp) {
      gestureHandledRef.current = true;
      dragYRef.current = 0;
      setDragY(0);
      dismiss();
      return;
    }

    // Swipe down → open the conversation.
    if (delta >= SWIPE_DOWN_OPEN_PX) {
      gestureHandledRef.current = true;
      dragYRef.current = 0;
      setDragY(0);
      open();
      return;
    }

    // Incomplete gesture: settle back to rest.
    dragYRef.current = 0;
    setDragY(0);
  };

  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Pointer path already opened or dismissed - avoid double navigation.
    if (gestureHandledRef.current) {
      event.preventDefault();
      event.stopPropagation();
      gestureHandledRef.current = false;
      return;
    }
    open();
  };

  const relative = formatRelativeShort(toast.createdAt);
  const showCount = toast.unreadCount > 1;

  // While dragging up, fade with the finger so release-to-dismiss feels committed.
  const dragOpacity =
    dragY < 0 ? Math.max(0.25, 1 + dragY / 120) : dragY > 0 ? Math.max(0.85, 1 - dragY / 200) : 1;

  return (
    <div
      role="button"
      tabIndex={exiting ? -1 : 0}
      aria-hidden={exiting || undefined}
      aria-label={`Message from ${toast.title}: ${toast.preview}. ${relative}. Swipe up to dismiss, swipe down or tap to open.`}
      onClick={exiting ? undefined : onClick}
      onKeyDown={exiting ? undefined : onKeyDown}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onPointerDown={exiting ? undefined : onPointerDown}
      onPointerMove={exiting ? undefined : onPointerMove}
      onPointerUp={exiting ? undefined : endPointer}
      onPointerCancel={exiting ? undefined : endPointer}
      className={cn(
        'pointer-events-auto relative w-full cursor-pointer select-none',
        // A touch under full banner width so side margins still breathe.
        'max-w-[26rem] md:max-w-[28rem]',
        'glass-surface rounded-lg',
        'px-3 py-2',
        'shadow-sm',
        'focus-ring outline-none',
        // Own both vertical directions so the browser does not steal the swipe.
        'touch-none',
        // Slide down in / slide up out. Update keeps the shell still.
        !exiting && !dragging && motion === 'enter' && 'motion-safe:animate-toast-in',
        exiting && 'pointer-events-none motion-safe:animate-toast-out',
        className,
      )}
      style={
        // While exiting, leave transform to the CSS slide-up - do not pin a drag offset.
        !exiting && (dragging || dragY !== 0)
          ? {
              transform: `translateY(${dragY}px)`,
              opacity: dragOpacity,
              transition: dragging
                ? 'none'
                : 'transform 180ms var(--ease-exit), opacity 180ms var(--ease-exit)',
            }
          : undefined
      }
    >
      <div className="flex items-center gap-3">
        <Avatar
          name={toast.senderName}
          id={toast.senderId}
          src={toast.senderAvatarUrl}
          size="sm"
          className="shrink-0"
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="min-w-0 flex-1 truncate text-body font-medium leading-snug text-ink">
              {toast.title}
            </p>
            {relative !== 'now' && (
              <time
                dateTime={new Date(toast.createdAt).toISOString()}
                className="shrink-0 text-caption tabular-nums text-text-tertiary"
              >
                {relative}
              </time>
            )}
          </div>

          <div className="mt-0.5 flex min-w-0 items-center gap-2">
            <p
              key={toast.generation}
              className={cn(
                'min-w-0 flex-1 truncate text-caption leading-snug text-text-secondary',
                motion === 'update' && 'motion-safe:animate-fade-in',
              )}
            >
              {toast.preview}
            </p>
            {showCount && (
              <Badge
                count={toast.unreadCount}
                tone="brand"
                srSuffix="unread"
                className="h-4 min-w-4 shrink-0 px-1 text-[0.625rem] font-medium leading-none"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const MESSAGE_TOAST_EXIT_MS = EXIT_MS;
export const MESSAGE_TOAST_GAP_MS = GAP_AFTER_EXIT_MS;
export const MESSAGE_TOAST_DURATION_MS = DISMISS_MS;

function formatRelativeShort(ms: number, now = Date.now()): string {
  const delta = Math.max(0, now - ms);
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
