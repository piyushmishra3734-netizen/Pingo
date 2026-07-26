import { cn } from '@pingo/ui';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The context menu shell: dim, lift, and where things sit.
 *
 * Implements docs/13 § 2 — anchoring, flipping and adaptive reach. The
 * reaction bar and the action list are passed in; this owns only the geometry,
 * because that is the part every one of them has to agree on.
 *
 * ## Dim, not blur
 *
 * docs/13 § 2: blur is the app announcing a modal, a dim is the app stepping
 * back. Only one of those is calm.
 */

/** docs/13 § 6, in ms. Dismiss is quicker than entry. */
const ENTER_MS = 160;

/** How far a message rises off the thread. docs/13 § 2. */
const LIFT_PX = 3;

/**
 * Below this fraction of the viewport is comfortable for a thumb.
 *
 * docs/13 § 2.2 — on a 6.7–6.9" phone the top third is out of range, so
 * anything resting above this line gets pulled down toward the hand.
 */
const REACH_LINE = 0.55;

/** Breathing room between the bubble and what sits either side of it. */
const GAP_PX = 10;

export interface MessageContextMenuProps {
  /** Where the message is on screen, measured at press time. */
  anchor: DOMRect;
  /**
   * Where the finger was.
   *
   * docs/13 § 2.3: a message taller than the viewport anchors to the touch
   * point instead of its own edge, because there is no edge worth using.
   */
  touch: { x: number; y: number };
  reactions: ReactNode;
  actions: ReactNode;
  onDismiss: () => void;
  children: ReactNode;
}

export function MessageContextMenu({
  anchor,
  touch,
  reactions,
  actions,
  onDismiss,
  children,
}: MessageContextMenuProps) {
  const scrimRef = useRef<HTMLDivElement>(null);

  /*
   * Scroll dismisses without acting. docs/13 § 2.3: a thumb that has started to
   * scroll has already changed its mind, so this must not be a "cancel" the
   * user has to aim at.
   */
  useEffect(() => {
    const dismiss = () => onDismiss();
    window.addEventListener('scroll', dismiss, { passive: true, capture: true });
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, { capture: true });
      window.removeEventListener('resize', dismiss);
    };
  }, [onDismiss]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const layout = place(anchor, touch);

  return (
    <div
      ref={scrimRef}
      role="dialog"
      aria-modal="true"
      aria-label="Message actions"
      onPointerDown={onDismiss}
      className={cn(
        'fixed inset-0 z-400',
        // 5–10% dim, and deliberately no blur. docs/13 § 2.
        'bg-ink/[0.08]',
        'animate-fade-in',
      )}
      style={{ animationDuration: `${ENTER_MS}ms` }}
    >
      {/* Reactions above, actions below — or swapped when the menu flips. */}
      <div
        // Taps inside act; only the scrim dismisses.
        onPointerDown={(event) => event.stopPropagation()}
        className="pointer-events-none absolute inset-0"
      >
        <div
          className="pointer-events-auto absolute origin-bottom animate-panel-in"
          style={{
            left: layout.left,
            top: layout.reactionsTop,
            animationDuration: `${ENTER_MS}ms`,
          }}
        >
          {reactions}
        </div>

        {/*
          The message itself, lifted out of the thread and drawn here so it sits
          above the dim. It keeps its measured position, which is what makes the
          lift read as the bubble rising rather than as a copy appearing.
        */}
        <div
          className="pointer-events-none absolute transition-transform"
          style={{
            left: anchor.left,
            top: anchor.top,
            width: anchor.width,
            transform: `translateY(-${LIFT_PX}px)`,
            transitionDuration: '180ms',
            filter: 'drop-shadow(0 6px 16px rgb(16 17 20 / 0.14))',
          }}
        >
          {children}
        </div>

        <div
          className="pointer-events-auto absolute origin-top animate-panel-in"
          style={{
            left: layout.left,
            top: layout.actionsTop,
            animationDuration: `${ENTER_MS}ms`,
          }}
        >
          {actions}
        </div>
      </div>
    </div>
  );
}

interface Layout {
  left: number;
  reactionsTop: number;
  actionsTop: number;
}

/**
 * Decides where the two groups sit.
 *
 * Three rules from docs/13 § 2, applied in order:
 *
 *   1. Reactions above the bubble, actions below — the default.
 *   2. Near the bottom, the action list flips above so it stays on screen.
 *   3. Adaptive reach: if the whole arrangement rests above the reach line, it
 *      slides down toward the thumb — but never so far that the bubble leaves
 *      the screen, because the spatial tie is the point.
 *
 * A message taller than the viewport has no useful edge, so both groups
 * anchor to the touch point instead.
 */
function place(anchor: DOMRect, touch: { x: number; y: number }): Layout {
  const viewport = window.innerHeight;
  const oversized = anchor.height > viewport * 0.6;

  const top = oversized ? touch.y : anchor.top;
  const bottom = oversized ? touch.y : anchor.bottom;

  // Estimates, refined once the groups have measured themselves.
  const reactionsHeight = 48;
  const actionsHeight = 190;

  let reactionsTop = top - reactionsHeight - GAP_PX;
  let actionsTop = bottom + GAP_PX;

  // Rule 2: no room below, so the actions go above the reactions.
  if (actionsTop + actionsHeight > viewport) {
    actionsTop = top - actionsHeight - GAP_PX;
    reactionsTop = actionsTop - reactionsHeight - GAP_PX;
  }

  // Rule 3: pull an out-of-reach arrangement down, capped so the bubble stays.
  const reachLine = viewport * REACH_LINE;
  if (actionsTop + actionsHeight < reachLine) {
    const wanted = reachLine - (actionsTop + actionsHeight);
    const room = viewport - (bottom + GAP_PX);
    const slide = Math.max(0, Math.min(wanted, room));
    reactionsTop += slide;
    actionsTop += slide;
  }

  return {
    left: anchor.left,
    reactionsTop: Math.max(GAP_PX, reactionsTop),
    actionsTop: Math.min(viewport - actionsHeight - GAP_PX, actionsTop),
  };
}
