import { CameraIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

/**
 * The wide band behind a face.
 *
 * ## Why there is a drag and not a crop editor
 *
 * A cover is a wide strip taken out of a photo that was almost never wide, so
 * the part worth seeing is hardly ever in the middle - centre a portrait and
 * the band frames a chin. Every cover on every product therefore needs some way
 * to say "not there, here".
 *
 * The expensive answer is a second crop editor: a canvas, a zoom, an export, an
 * upload. The cheap one is that the browser already has this. `object-position`
 * takes one number, the image is untouched, and moving it costs a drag and a
 * `smallint`. Nothing is re-encoded, nothing is re-uploaded, and the original
 * photo stays whole in the bucket - so changing your mind later is another
 * drag rather than another upload of a picture you no longer have.
 *
 * ponytail: reposition only, no zoom. The image is drawn `object-cover`, so it
 * is already scaled to fill; a zoom would mean a real crop, which means the
 * canvas and the export this deliberately avoids. Add it when somebody asks
 * for a tighter frame rather than a different part of the same one.
 *
 * Deliberately no `transform` on the image. A composited layer behind content
 * paints over it, and this one sits underneath an avatar and a name.
 */

/** How far a drag has to travel before it counts as one and not a tap. */
const DRAG_SLOP_PX = 4;

export interface ProfileCoverProps {
  src?: string;
  /** Vertical percent to centre on, 0-100. */
  offset: number;
  /** Only the owner may change or move it. */
  editable?: boolean;
  onPick?: () => void;
  /** Fires once, when the drag ends - not on every pixel of it. */
  onOffsetChange?: (offset: number) => void;
  /** A picture is being prepared or sent: shown over the band so the pick does not look ignored. */
  busy?: boolean;
  /** What is going on, in words, beside the spinner. */
  busyLabel?: string;
  /** 0 to 1 while an upload reports it; without it the bar is not drawn. */
  progress?: number;
  /** A picked cover that is waiting for Save, so it is clear nothing has gone up yet. */
  pending?: boolean;
}

export function ProfileCover({
  src,
  offset,
  editable = false,
  onPick,
  onOffsetChange,
  busy = false,
  busyLabel,
  progress,
  pending = false,
}: ProfileCoverProps) {
  const [dragging, setDragging] = useState(false);
  const band = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const start = useRef<{ y: number; from: number; moved: boolean } | null>(null);
  /*
   * Where the picture is right now, outside React.
   *
   * It used to be state, so every pointer move re-rendered the card and then
   * the browser re-laid-out the image - a drag that felt like pulling through
   * glue. The number now lives in a ref and goes straight onto the element,
   * once per frame; React hears about it when the finger lifts.
   */
  const live = useRef(offset);
  const frame = useRef(0);

  const paint = (value: number) => {
    live.current = value;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (image.current) image.current.style.objectPosition = `50% ${live.current}%`;
    });
  };

  // Somebody else's cover, or our own after a save: follow the stored value.
  useEffect(() => {
    if (dragging) return;
    live.current = offset;
    if (image.current) image.current.style.objectPosition = `50% ${offset}%`;
  }, [offset, dragging, src]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const canMove = editable && Boolean(src);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!canMove) return;
    start.current = { y: e.clientY, from: live.current, moved: false };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const from = start.current;
    if (!from) return;
    const dy = e.clientY - from.y;
    if (!from.moved && Math.abs(dy) < DRAG_SLOP_PX) return;
    from.moved = true;
    /*
     * The band's own height is the travel, not the window's. Dragging the full
     * height of the strip should sweep the whole picture; scaling it to
     * anything else makes the image feel either glued down or frictionless.
     */
    const height = band.current?.clientHeight || 1;
    paint(Math.max(0, Math.min(100, from.from - (dy / height) * 100)));
  };

  const onPointerUp = () => {
    const from = start.current;
    start.current = null;
    setDragging(false);
    if (!from) return;
    // A tap is not a reposition - it is somebody wanting to change the picture.
    if (!from.moved) onPick?.();
    else if (Math.round(live.current) !== Math.round(offset)) onOffsetChange?.(Math.round(live.current));
  };

  return (
    <div
      ref={band}
      className={cn(
        /*
         * As tall as a cover needs to be, and no taller.
         *
         * It went to 160 when the face sat inside it, which meant the band had
         * to hold a circle *and* air around the circle - and the top of the
         * profile became a picture of nothing. The face hangs off the bottom
         * again, so this is back to being a strip of somebody's photograph.
         */
        // The top of the profile card: the card draws its edge, this fills it.
        'absolute inset-x-0 top-0 h-[150px] overflow-hidden bg-brand-wash',
        /*
         * `touch-none` is what makes the drag work on a phone at all. The drag is
         * vertical, which is also the page's own scroll gesture; without this the
         * browser took the gesture for a scroll, cancelled the pointer a few
         * pixels in, and the cover stuttered between the two.
         */
        canMove && (dragging ? 'cursor-grabbing touch-none' : 'cursor-grab touch-none'),
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {src ? (
        <img
          ref={image}
          src={src}
          alt=""
          decoding="async"
          className="absolute inset-0 h-full w-full select-none object-cover"
          style={{ objectPosition: `50% ${offset}%` }}
          draggable={false}
        />
      ) : (
        // No photo: a wash of the PINGO sweep, the logo's own colours, at a whisper.
        <div className="bg-sweep absolute inset-0 opacity-[.24]" />
      )}

      {busy ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40" role="status" aria-live="polite">
          <span aria-hidden className="size-7 animate-spin rounded-full border-[3px] border-white/40 border-t-white motion-reduce:animate-none" />
          <span className="text-caption font-medium tabular-nums text-white">
            {busyLabel ?? 'Working…'}
            {progress !== undefined ? ` ${Math.round(progress * 100)}%` : ''}
          </span>
          {progress !== undefined ? (
            <span aria-hidden className="h-1 w-40 overflow-hidden rounded-full bg-white/30">
              <span className="block h-full rounded-full bg-white transition-[width] duration-150 ease-standard" style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
          ) : null}
        </div>
      ) : null}

      {pending && !busy ? (
        <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm">
          New cover · uploads when you tap Save
        </span>
      ) : null}

      {/*
        A scrim, always, not only over a photo.

        The avatar and the name sit on top of this, and a cover somebody chose
        is by definition a picture nobody vetted for contrast - a bright sky
        behind a light monogram is unreadable and there is no way to know in
        advance. Cheap, and it also stops the band competing with the face.
      */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent from-35% to-surface" />

      {editable ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPick?.();
          }}
          className={cn(
            // Top corner: the bottom of the band is under the face now.
            'focus-ring absolute right-3 top-3 flex items-center gap-1.5 rounded-full',
            'bg-black/35 px-3 py-1.5 text-caption font-medium text-white',
            'active:scale-[0.97]',
          )}
        >
          <CameraIcon size={15} />
          {src ? 'Change cover' : 'Add cover'}
        </button>
      ) : null}

      {canMove && !dragging ? (
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/35 px-2.5 py-1 text-[11px] text-white">
          Drag to reposition
        </span>
      ) : null}
    </div>
  );
}
