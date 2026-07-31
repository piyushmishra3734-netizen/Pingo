import { Avatar, Badge, cn } from '@pingo/ui';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent,
} from 'react';

/**
 * Floating message banner - continuous gesture motion.
 *
 * ## The snap-back bug (fixed)
 *
 * Swipe-up used to zero the drag transform, then play exit from rest - so the
 * banner dropped down before flying up. Commit now continues from the finger's
 * last Y straight off-screen. Same idea for open: glide down from rest or from
 * a pull, then hand off to navigation.
 *
 * ## Gestures
 *
 * - Tap → glide down, open chat
 * - Swipe up → continue up and dismiss
 * - Swipe down → continue down and open chat
 * - Incomplete swipe → liquid settle back to rest
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
  /** Called after the banner has fully left (up). Parent unmounts + queues next. */
  onDismiss: (id: string) => void;
  /** Called after the banner has finished its open glide (down). Parent navigates. */
  onOpen: (conversationId: string) => void;
  durationMs?: number;
  paused?: boolean;
  className?: string;
}

const DISMISS_MS = 3800;

/** Budget for a full leave when not continuing from a drag. */
const EXIT_MS = 360;

/** Empty gap before the next banner may enter. */
const GAP_AFTER_EXIT_MS = 500;

const SWIPE_UP_DISMISS_PX = 28;
const SWIPE_DOWN_OPEN_PX = 36;
const TAP_SLOP_PX = 10;
const DRAG_UP_MAX = 160;
const DRAG_DOWN_MAX = 96;

/** Liquid settle - same family as PINGO sheets. */
const EASE_LIQUID = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_EXIT = 'cubic-bezier(0.4, 0, 1, 1)';

type Phase =
  | 'idle'
  | 'dragging'
  | 'settling'
  | 'leaving-up'
  | 'leaving-down';

export function MessageToast({
  toast,
  motion = 'enter',
  onOpen,
  onDismiss,
  durationMs = DISMISS_MS,
  paused = false,
  className,
}: MessageToastProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [hovering, setHovering] = useState(false);
  /** Live transform in px (finger + commit animation target). */
  const [y, setY] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const [scale, setScale] = useState(1);
  const [animated, setAnimated] = useState(false);

  const remainingRef = useRef(durationMs);
  const startedAtRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointerStartY = useRef<number | undefined>(undefined);
  const pointerStartTime = useRef(0);
  const yRef = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const gestureHandledRef = useRef(false);
  const finishedRef = useRef(false);
  /** Parent-driven exit must not re-fire if we already committed locally. */
  const localCommitRef = useRef(false);

  phaseRef.current = phase;

  const setYBoth = (value: number) => {
    yRef.current = value;
    setY(value);
  };

  const finishDismiss = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onDismiss(toast.id);
  }, [onDismiss, toast.id]);

  const finishOpen = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onOpen(toast.conversationId);
  }, [onOpen, toast.conversationId]);

  /**
   * Two-frame commit: hold current Y without transition, then animate to target
   * so the motion continues from the finger instead of jumping to rest first.
   */
  const commitTransform = useCallback(
    (next: Phase, targetY: number, targetOpacity: number, targetScale: number) => {
      localCommitRef.current = true;
      setPhase(next);
      phaseRef.current = next;
      setAnimated(false);
      // Keep current y/opacity for one frame.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimated(true);
          setYBoth(targetY);
          setOpacity(targetOpacity);
          setScale(targetScale);
        });
      });
    },
    [],
  );

  const commitLeaveUp = useCallback(() => {
    const height = rootRef.current?.offsetHeight ?? 64;
    // Fully above the slot, from wherever the finger left off.
    const target = -(height + 48);
    const from = yRef.current;
    // Always go further up than the drag, never back down.
    const dest = Math.min(from - 8, target);
    commitTransform('leaving-up', dest, 0, 1);
  }, [commitTransform]);

  const commitLeaveDown = useCallback(() => {
    const height = rootRef.current?.offsetHeight ?? 64;
    const from = yRef.current;
    // Soft push into the screen, then dissolve - hands the eye to the chat.
    const dest = Math.max(from + 8, Math.round(height * 0.55));
    commitTransform('leaving-down', dest, 0, 0.97);
  }, [commitTransform]);

  const settleHome = useCallback(() => {
    setPhase('settling');
    phaseRef.current = 'settling';
    setAnimated(true);
    setYBoth(0);
    setOpacity(1);
    setScale(1);
  }, []);

  // Auto-dismiss timer - only while fully interactive.
  useEffect(() => {
    remainingRef.current = durationMs;
    startedAtRef.current = Date.now();
  }, [toast.generation, durationMs]);

  useEffect(() => {
    const busy =
      phase === 'dragging' ||
      phase === 'leaving-up' ||
      phase === 'leaving-down' ||
      phase === 'settling';
    if (busy || motion === 'exit') return;

    const frozen = hovering || paused;
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
    timerRef.current = setTimeout(() => {
      if (localCommitRef.current || finishedRef.current) return;
      commitLeaveUp();
    }, remainingRef.current);

    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
  }, [commitLeaveUp, hovering, motion, paused, phase, toast.generation]);

  // Parent asked us to leave (queued replace, open from elsewhere, etc.).
  useLayoutEffect(() => {
    if (motion !== 'exit') return;
    if (localCommitRef.current) return;
    if (phaseRef.current === 'leaving-up' || phaseRef.current === 'leaving-down') return;
    commitLeaveUp();
  }, [motion, commitLeaveUp]);

  const onTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== 'transform' && event.propertyName !== 'opacity') return;

    if (phaseRef.current === 'leaving-up') {
      finishDismiss();
      return;
    }
    if (phaseRef.current === 'leaving-down') {
      finishOpen();
      return;
    }
    if (phaseRef.current === 'settling') {
      setPhase('idle');
      phaseRef.current = 'idle';
      setAnimated(false);
    }
  };

  // Safety net if transitionend is missed (tab background, reduced motion).
  useEffect(() => {
    if (phase !== 'leaving-up' && phase !== 'leaving-down') return;
    const ms = EXIT_MS + 80;
    const id = window.setTimeout(() => {
      if (phaseRef.current === 'leaving-up') finishDismiss();
      if (phaseRef.current === 'leaving-down') finishOpen();
    }, ms);
    return () => window.clearTimeout(id);
  }, [phase, finishDismiss, finishOpen]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (phase === 'leaving-up' || phase === 'leaving-down') return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      gestureHandledRef.current = true;
      commitLeaveDown();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      gestureHandledRef.current = true;
      commitLeaveUp();
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (phase === 'leaving-up' || phase === 'leaving-down') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    gestureHandledRef.current = false;
    pointerStartY.current = event.clientY;
    pointerStartTime.current = Date.now();
    setPhase('dragging');
    phaseRef.current = 'dragging';
    setAnimated(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerStartY.current === undefined) return;
    if (phaseRef.current !== 'dragging') return;

    const delta = event.clientY - pointerStartY.current;
    const next = Math.max(-DRAG_UP_MAX, Math.min(DRAG_DOWN_MAX, delta));
    setYBoth(next);

    if (next < 0) {
      setOpacity(Math.max(0.28, 1 + next / 130));
      setScale(1);
    } else if (next > 0) {
      setOpacity(Math.max(0.75, 1 - next / 220));
      setScale(1 - Math.min(0.03, next / 2400));
    } else {
      setOpacity(1);
      setScale(1);
    }
  };

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerStartY.current === undefined) return;
    if (phaseRef.current !== 'dragging') return;

    const delta = yRef.current;
    const elapsed = Math.max(1, Date.now() - pointerStartTime.current);
    const velocity = delta / elapsed;

    pointerStartY.current = undefined;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // released
    }

    // Tap
    if (Math.abs(delta) < TAP_SLOP_PX) {
      gestureHandledRef.current = true;
      commitLeaveDown();
      return;
    }

    // Flick / swipe up → continue upward, never reverse
    const flickedUp = velocity < -0.32 && delta < -10;
    if (delta <= -SWIPE_UP_DISMISS_PX || flickedUp) {
      gestureHandledRef.current = true;
      commitLeaveUp();
      return;
    }

    // Swipe down → continue downward into open
    if (delta >= SWIPE_DOWN_OPEN_PX || velocity > 0.35) {
      gestureHandledRef.current = true;
      commitLeaveDown();
      return;
    }

    // Incomplete - liquid return home
    settleHome();
  };

  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (gestureHandledRef.current) {
      event.preventDefault();
      event.stopPropagation();
      gestureHandledRef.current = false;
      return;
    }
    if (phase === 'leaving-up' || phase === 'leaving-down') return;
    gestureHandledRef.current = true;
    commitLeaveDown();
  };

  const relative = formatRelativeShort(toast.createdAt);
  const showCount = toast.unreadCount > 1;
  const leaving = phase === 'leaving-up' || phase === 'leaving-down';
  const dragging = phase === 'dragging';

  // Idle at rest: no inline transform so CSS enter animation can own the first paint.
  // Drag / settle / leave: continuous transform from the finger (or last Y).
  const style: CSSProperties | undefined =
    phase === 'idle' && y === 0 && !animated
      ? undefined
      : {
          transform: `translateY(${y}px) scale(${scale})`,
          opacity,
          transition: animated
            ? phase === 'settling'
              ? `transform 320ms ${EASE_LIQUID}, opacity 280ms ${EASE_LIQUID}`
              : phase === 'leaving-down'
                ? `transform 380ms ${EASE_LIQUID}, opacity 340ms ${EASE_LIQUID}`
                : `transform 340ms ${EASE_EXIT}, opacity 300ms ${EASE_EXIT}`
            : 'none',
          willChange:
            dragging || leaving || phase === 'settling' ? 'transform, opacity' : undefined,
        };

  return (
    <div
      ref={rootRef}
      role="button"
      tabIndex={leaving ? -1 : 0}
      aria-hidden={leaving || undefined}
      aria-label={`Message from ${toast.title}: ${toast.preview}. ${relative}. Swipe up to dismiss, swipe down or tap to open.`}
      onClick={leaving ? undefined : onClick}
      onKeyDown={leaving ? undefined : onKeyDown}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onPointerDown={leaving ? undefined : onPointerDown}
      onPointerMove={leaving ? undefined : onPointerMove}
      onPointerUp={leaving ? undefined : endPointer}
      onPointerCancel={leaving ? undefined : endPointer}
      onTransitionEnd={onTransitionEnd}
      className={cn(
        'pointer-events-auto relative w-full cursor-pointer select-none',
        'max-w-[26rem] md:max-w-[28rem]',
        'glass-surface rounded-lg',
        'px-3 py-2',
        'shadow-sm',
        'focus-ring outline-none',
        'touch-none',
        // Enter only when truly idle - never fight a drag or leave.
        phase === 'idle' &&
          motion === 'enter' &&
          y === 0 &&
          'motion-safe:animate-toast-in',
        leaving && 'pointer-events-none',
        className,
      )}
      style={style}
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
                motion === 'update' &&
                  phase === 'idle' &&
                  'motion-safe:animate-fade-in',
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
