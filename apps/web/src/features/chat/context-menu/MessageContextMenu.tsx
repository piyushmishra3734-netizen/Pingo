import { cn } from '@pingo/ui';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

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
    const onScroll = (event: Event) => {
      /*
       * Scrolling the menu is not scrolling away from it.
       *
       * Level 2 is a scrolling sheet, and capture-phase listening sees its
       * scroll too — so without this, reaching the bottom of the sheet closes
       * the thing you were reaching into.
       */
      const target = event.target;
      if (target instanceof Node && scrimRef.current?.contains(target)) return;
      onDismiss();
    };

    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onDismiss);
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onDismiss);
    };
  }, [onDismiss]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  /*
   * The action panel is measured, not assumed.
   *
   * Level 1 is four rows; Level 2 is a scrolling sheet several times taller,
   * and it replaces Level 1 in place. Placing both from one estimate put the
   * bottom of Level 2 past the bottom of the screen, where Edit and Delete
   * could not be reached at all — the panel scrolls internally, but nothing
   * inside the viewport was scrollable to bring them up. So the size feeds back
   * into placement, and switching level re-places.
   */
  const actionsRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(ESTIMATE);

  useLayoutEffect(() => {
    const element = actionsRef.current;
    if (!element) return;

    const measure = () => {
      const box = element.getBoundingClientRect();
      // Rounded, so sub-pixel jitter cannot loop the observer forever.
      setSize((previous) => {
        const next = { height: Math.round(box.height), width: Math.round(box.width) };
        return next.height === previous.height && next.width === previous.width
          ? previous
          : next;
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [actions]);

  const layout = place(anchor, touch, size);

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
          ref={actionsRef}
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

/** The measured action panel. */
interface Size {
  height: number;
  width: number;
}

/**
 * What Level 1 comes out at.
 *
 * Used for the first frame only, so the common case is placed correctly before
 * anything is measured and does not visibly settle afterwards.
 */
const ESTIMATE: Size = { height: 190, width: 176 };

/** The reaction bar is one fixed row, so this one really is a constant. */
const REACTIONS_HEIGHT = 48;

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
function place(anchor: DOMRect, touch: { x: number; y: number }, size: Size): Layout {
  const viewport = window.innerHeight;
  const oversized = anchor.height > viewport * 0.6;

  const top = oversized ? touch.y : anchor.top;
  const bottom = oversized ? touch.y : anchor.bottom;

  const reactionsHeight = REACTIONS_HEIGHT;
  /*
   * A panel taller than the screen is capped rather than placed, so the clamp
   * below cannot push its top off the top edge trying to fit the bottom on.
   * The panel scrolls internally past this point, which is what `max-h` is for.
   */
  const actionsHeight = Math.min(size.height, viewport - GAP_PX * 2);

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

  /*
   * Horizontal clamp.
   *
   * The panel starts at the bubble's left edge, and an outgoing bubble sits
   * against the right side of the thread — so a panel wider than the bubble
   * hangs off the screen. Sliding it back keeps the tie to the message without
   * putting half the rows past the edge.
   */
  const left = Math.max(
    GAP_PX,
    Math.min(anchor.left, window.innerWidth - size.width - GAP_PX),
  );

  return {
    left,
    reactionsTop: Math.max(GAP_PX, reactionsTop),
    // Both ends, and in this order: pinning the bottom on screen must not push
    // the top off it when the panel is tall.
    actionsTop: Math.max(
      GAP_PX,
      Math.min(viewport - actionsHeight - GAP_PX, actionsTop),
    ),
  };
}
