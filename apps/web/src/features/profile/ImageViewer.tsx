import { CloseIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { Overlay } from '../../components/Overlay.js';

/**
 * A picture, full screen, with pinch to zoom and swipe down to dismiss.
 *
 * Used by the profile photo and by the post viewer, because they are the same
 * gesture problem: one image, two fingers, and a way out that does not require
 * finding a small button.
 *
 * ## Why the gestures are written out rather than delegated to the browser
 *
 * `touch-action: pinch-zoom` gives the browser's own zoom, which pans the whole
 * page and cannot be told that dragging down means "close". Once one of the two
 * gestures has to be ours, both do - a browser zoom fighting a JavaScript drag
 * is how a viewer ends up half-dismissed and stuck.
 *
 * ## The two gestures never overlap
 *
 * One finger drags; two fingers pinch. The moment a second pointer arrives the
 * drag is abandoned rather than blended, because a pinch always begins with one
 * finger touching a fraction before the other, and treating that first frame as
 * a drag makes every zoom start with a lurch.
 *
 * A drag only dismisses while the picture is at its natural size. Once zoomed
 * in, one finger pans instead - otherwise moving down to look at the bottom of
 * a photo would throw it off the screen.
 */

const MAX_SCALE = 4;
/** How far down before letting go closes it. Roughly a thumb's travel. */
const DISMISS_DISTANCE = 110;

interface Point {
  x: number;
  y: number;
}

export interface ImageViewerProps {
  src: string;
  alt: string;
  onClose: () => void;
  /** Rendered along the bottom, above the safe area. Captions, actions. */
  footer?: React.ReactNode;
}

export function ImageViewer({ src, alt, onClose, footer }: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  /** Set only while a one-finger drag at natural size is in progress. */
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const pointers = useRef(new Map<number, Point>());
  const start = useRef<
    { point: Point; offset: Point; distance: number; scale: number } | undefined
  >(undefined);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Once, on open. Kept apart from the key handler because `onClose` is an
  // inline arrow in every caller, so a combined effect would re-run on each
  // parent render and yank focus back mid-gesture.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const spread = (): number => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const centre = (): Point => {
    const all = [...pointers.current.values()];
    const sum = all.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / all.length, y: sum.y / all.length };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // A second finger ends the drag rather than blending into it. See above.
    if (pointers.current.size === 2) setDragY(0);

    start.current = {
      point: centre(),
      offset,
      distance: spread(),
      scale,
    };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId) || !start.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2) {
      const distance = spread();
      if (start.current.distance > 0) {
        const next = Math.min(
          MAX_SCALE,
          Math.max(1, (start.current.scale * distance) / start.current.distance),
        );
        setScale(next);
        // Back to natural size means back to centre, or the picture stays
        // nudged off to one side with no way to notice why.
        if (next === 1) setOffset({ x: 0, y: 0 });
      }
      return;
    }

    const moved = {
      x: event.clientX - start.current.point.x,
      y: event.clientY - start.current.point.y,
    };

    if (scale > 1) {
      setOffset({ x: start.current.offset.x + moved.x, y: start.current.offset.y + moved.y });
      return;
    }

    // At natural size a downward drag is the way out. Upward does nothing  - 
    // there is nothing above the picture to go to.
    setDragY(Math.max(0, moved.y));
  };

  const endPointer = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);

    if (pointers.current.size === 0) {
      setDragging(false);
      if (dragY > DISMISS_DISTANCE) {
        onClose();
        return;
      }
      setDragY(0);
      start.current = undefined;
      return;
    }

    // One finger left after a pinch: re-anchor so the picture does not jump.
    start.current = { point: centre(), offset, distance: spread(), scale };
  };

  /** Fades the scrim as the picture is pulled away - the drag has to feel real. */
  const dragProgress = Math.min(1, dragY / (DISMISS_DISTANCE * 2));

  return (
    <Overlay>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={alt}
        className="fixed inset-0 z-1000 flex flex-col"
        style={{ background: `rgba(11, 12, 16, ${0.94 - dragProgress * 0.5})` }}
      >
        <div className="relative flex items-center justify-end p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              'focus-ring grid size-11 place-items-center rounded-full',
              'bg-white/10 text-white backdrop-blur-glass',
              'transition-transform duration-instant active:scale-95',
            )}
          >
            <CloseIcon size={22} />
          </button>
        </div>

        <div
          className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          // The browser must not also pan, zoom or pull-to-refresh underneath.
          style={{ touchAction: 'none' }}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            className={cn(
              'max-h-full max-w-full object-contain select-none',
              // Only when the finger is up, so dragging tracks it exactly.
              !dragging && 'transition-transform duration-base ease-standard',
            )}
            style={{
              transform: `translate3d(${offset.x}px, ${offset.y + dragY}px, 0) scale(${scale})`,
              opacity: 1 - dragProgress * 0.35,
            }}
          />
        </div>

        {footer && (
          <div className="shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>
        )}
      </div>
    </Overlay>
  );
}
