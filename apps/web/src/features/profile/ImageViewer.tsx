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
  /** The picture itself, for the size the pan limits are measured against. */
  const imageRef = useRef<HTMLImageElement | null>(null);
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

  /*
   * The keyboard, which had nothing but Escape.
   *
   * A viewer that can only be driven by a pinch is a viewer a laptop cannot
   * use. Arrows move the picture, Ctrl with plus and minus zooms, and Ctrl+0
   * puts it back - the same keys the browser uses for the same ideas, taken
   * over here because the picture is what should be zooming, not the page.
   *
   * Read through refs rather than closed over: this listener is attached once,
   * and a version that depended on `scale` and `offset` would be torn down and
   * rebuilt on every frame of a pan.
   */
  const stateRef = useRef({ scale, offset });
  stateRef.current = { scale, offset };

  useEffect(() => {
    const STEP = 60;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      const { scale: at, offset: from } = stateRef.current;

      if (event.ctrlKey || event.metaKey) {
        const box = imageRef.current?.getBoundingClientRect();
        // Zoom about the middle of the picture: there is no cursor involved in
        // a keystroke, so the centre is the only honest anchor.
        const middle = box
          ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
          : { x: 0, y: 0 };

        if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          zoomAround(at * 1.25, middle, { scale: at, offset: from });
        } else if (event.key === '-' || event.key === '_') {
          event.preventDefault();
          zoomAround(at / 1.25, middle, { scale: at, offset: from });
        } else if (event.key === '0') {
          event.preventDefault();
          setScale(1);
          setOffset({ x: 0, y: 0 });
        }
        return;
      }

      // Arrows only mean something once there is somewhere to go.
      if (at <= 1) return;
      const move =
        event.key === 'ArrowLeft'
          ? { x: STEP, y: 0 }
          : event.key === 'ArrowRight'
            ? { x: -STEP, y: 0 }
            : event.key === 'ArrowUp'
              ? { x: 0, y: STEP }
              : event.key === 'ArrowDown'
                ? { x: 0, y: -STEP }
                : undefined;
      if (!move) return;

      event.preventDefault();
      setOffset(clamp({ x: from.x + move.x, y: from.y + move.y }, at));
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /**
   * How far the picture may be pushed before its edge comes inside the frame.
   *
   * Panning was unbounded, so a zoomed picture could be dragged into empty
   * space and left there - it looked like the picture had been lost rather
   * than moved. At natural size there is nothing to pan to and the answer is
   * zero, which is also what keeps a stray horizontal drag from nudging an
   * unzoomed photo sideways.
   */
  const panLimit = (at: number): Point => {
    const node = imageRef.current;
    if (!node || at <= 1) return { x: 0, y: 0 };
    return {
      x: (node.offsetWidth * (at - 1)) / 2,
      y: (node.offsetHeight * (at - 1)) / 2,
    };
  };

  const clamp = (value: Point, at: number): Point => {
    const limit = panLimit(at);
    return {
      x: Math.min(limit.x, Math.max(-limit.x, value.x)),
      y: Math.min(limit.y, Math.max(-limit.y, value.y)),
    };
  };

  /**
   * Zooms so that whatever is under `anchor` stays under `anchor`.
   *
   * The old version scaled about the element's centre, which is why zooming in
   * on a face at the edge of a photo moved that face further away: the middle
   * of the picture grew and everything else slid outwards. Pinching,
   * double-tapping and the wheel all go through here, so all three agree about
   * what a zoom is - the thing you are pointing at gets bigger where it is.
   */
  const zoomAround = (nextScale: number, anchor: Point, from: { scale: number; offset: Point }) => {
    const box = imageRef.current?.getBoundingClientRect();
    const target = Math.min(MAX_SCALE, Math.max(1, nextScale));

    if (!box || target === 1) {
      setScale(target);
      setOffset({ x: 0, y: 0 });
      return;
    }

    // The element's own centre, which is what the transform scales about.
    const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const ratio = target / from.scale;
    const next = {
      x: (anchor.x - middle.x) * (1 - ratio) + from.offset.x * ratio,
      y: (anchor.y - middle.y) * (1 - ratio) + from.offset.y * ratio,
    };

    setScale(target);
    setOffset(clamp(next, target));
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
      if (start.current.distance <= 0) return;

      const box = imageRef.current?.getBoundingClientRect();
      const target = Math.min(
        MAX_SCALE,
        Math.max(1, (start.current.scale * distance) / start.current.distance),
      );

      if (!box || target === 1) {
        setScale(target);
        setOffset({ x: 0, y: 0 });
        return;
      }

      /*
       * Anchored to where the pinch *started*, not to where the fingers are now.
       *
       * The first version passed the live midpoint as the anchor while also
       * measuring from the gesture's starting offset. Those two disagree the
       * instant a finger moves - the anchor slides, the offset is recomputed
       * from an origin that no longer matches it, and the picture wanders off
       * on its own. It looked like a glitch and it was arithmetic.
       *
       * The midpoint's own movement is added separately, as a pan, which is
       * what makes a two-finger gesture zoom and move together the way one
       * expects.
       */
      const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const ratio = target / start.current.scale;
      const anchor = start.current.point;
      const now = centre();

      setScale(target);
      setOffset(
        clamp(
          {
            x:
              (anchor.x - middle.x) * (1 - ratio) +
              start.current.offset.x * ratio +
              (now.x - anchor.x),
            y:
              (anchor.y - middle.y) * (1 - ratio) +
              start.current.offset.y * ratio +
              (now.y - anchor.y),
          },
          target,
        ),
      );
      return;
    }

    const moved = {
      x: event.clientX - start.current.point.x,
      y: event.clientY - start.current.point.y,
    };

    if (scale > 1) {
      setOffset(
        clamp(
          { x: start.current.offset.x + moved.x, y: start.current.offset.y + moved.y },
          scale,
        ),
      );
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

  /**
   * Double tap, and double click, to zoom.
   *
   * The only gesture available was a pinch, which does not exist on a laptop -
   * so on a desktop the viewer could not be zoomed at all, and on a phone it
   * was the one gesture people reach for second. Toggling rather than stepping:
   * a second double tap comes back out, so there is always a way back without
   * hunting for it.
   */
  const doubleTapAt = useRef(0);

  const toggleZoom = (at: Point) => {
    const zoomed = scale > 1;
    zoomAround(zoomed ? 1 : 2.5, at, { scale, offset });
  };

  const onPointerUpMaybeDouble = (event: React.PointerEvent) => {
    const now = Date.now();
    // Only a tap that did not drag, and only at natural size or already zoomed
    // - a pinch that ends near a previous tap is not a double tap.
    const quick = now - doubleTapAt.current < 300;
    doubleTapAt.current = quick ? 0 : now;
    if (quick && pointers.current.size === 0 && dragY === 0) {
      toggleZoom({ x: event.clientX, y: event.clientY });
    }
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
          onPointerUp={(event) => {
            onPointerUpMaybeDouble(event);
            endPointer(event);
          }}
          onPointerCancel={endPointer}
          onWheel={(event) => {
            // Ctrl+wheel is the browser's own zoom gesture and trackpads send
            // it for a pinch; plain wheel is a scroll nobody expects to zoom.
            if (!event.ctrlKey && Math.abs(event.deltaY) < 1) return;
            zoomAround(
              scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12),
              { x: event.clientX, y: event.clientY },
              { scale, offset },
            );
          }}
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
                // Kept, so the pan limits can be worked out from the size the
                // picture is actually laid out at.
                imageRef.current = node;
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
