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
 * gestures has to be ours, both do, a browser zoom fighting a JavaScript drag
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
 * in, one finger pans instead, otherwise moving down to look at the bottom of
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
  /**
   * Which src has actually decoded.
   *
   * Derived from the src rather than reset by an effect, and that is the bug
   * this replaces. An effect runs *after* paint, and a cached image fires
   * `onLoad` before it — so opening a photo the page had already loaded set
   * ready, the effect immediately unset it, and no second `onLoad` ever came.
   * The spinner turned for ever over a picture that was sitting right there,
   * which is exactly what holding a profile photo did.
   */
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const [failedSrc, setFailedSrc] = useState<string>();
  const photoReady = loadedSrc === src;

  /**
   * Whether the blur has finished being removed, and the filter can go entirely.
   *
   * `blur(0px)` looks like nothing and is not nothing: it keeps the picture on
   * a filtered compositing layer, and Chrome stops animating a GIF that sits on
   * one. So a GIF opened full screen froze on whatever frame it happened to be
   * showing, while the same GIF went on playing in the thread behind it.
   *
   * Dropping the filter outright would lose the blur-up, which is the thing
   * that makes a slow photo feel like it is arriving rather than missing. So
   * the blur still animates away, and then the filter is removed once it has
   * nothing left to do.
   */
  const [sharp, setSharp] = useState(false);

  useEffect(() => {
    if (!photoReady) {
      setSharp(false);
      return;
    }
    // A shade past --duration-slow at its longest setting, so the swap never
    // lands mid-transition and snaps the blur away early.
    const timer = window.setTimeout(() => setSharp(true), 460);
    return () => window.clearTimeout(timer);
  }, [photoReady, src]);
  const photoFailed = failedSrc === src;

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
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          // The browser must not also pan, zoom or pull-to-refresh underneath.
          style={{ touchAction: 'none' }}
        >
          {/*
            No spinner. The picture arrives blurred and sharpens.

            A spinner says "wait"; a blur says "here it is, nearly". The
            second is true — the browser is decoding an image it already has
            bytes for, and on a photo the page has cached that decode is
            instant, so what somebody sees is a soft picture snapping into
            focus rather than a wheel that appears and vanishes.

            It is the same `src`, so there is nothing extra to download: the
            blur is a filter on the real image, removed once it has loaded.
          */}

          {photoFailed ? (
            <p className="px-8 text-center text-body text-white/55">
              Could not load this photo.
            </p>
          ) : (
            <img
              src={src}
              alt={alt}
              draggable={false}
              /*
                Catches the image that was already in the cache.

                `onLoad` does not fire for an image the browser had before this
                element existed, and that is the common case here — the small
                avatar is on the page already. Without this the picture would
                stay blurred for ever.
              */
              ref={(node) => {
                if (node?.complete && node.naturalWidth > 0) setLoadedSrc(src);
              }}
              onLoad={() => setLoadedSrc(src)}
              onError={() => setFailedSrc(src)}
              className={cn(
                'max-h-full max-w-full object-contain select-none',
                // Only when the finger is up, so dragging tracks it exactly.
                !dragging && 'transition-[transform,opacity,filter] duration-slow ease-standard',
              )}
              style={{
                /*
                  Blurred until it has decoded, then sharp. Never hidden.

                  The old version held the picture at zero opacity behind a
                  spinner, so a slow photo was a blank screen with a wheel on
                  it. Blur shows the shape of what is coming from the first
                  frame the browser can paint anything at all — and the slight
                  overscale keeps the blur from showing soft edges.
                */
                transform: `translate3d(${offset.x}px, ${offset.y + dragY}px, 0) scale(${photoReady ? scale : scale * 1.06})`,
                opacity: 1 - dragProgress * 0.35,
                // `none`, not `blur(0px)` - see `sharp`. The difference is
                // invisible and decides whether a GIF plays.
                filter: sharp ? 'none' : photoReady ? 'blur(0px)' : 'blur(22px)',
              }}
            />
          )}
        </div>

        {footer && (
          <div className="shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>
        )}
      </div>
    </Overlay>
  );
}
