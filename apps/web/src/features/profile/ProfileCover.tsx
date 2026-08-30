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
}

export function ProfileCover({
  src,
  offset,
  editable = false,
  onPick,
  onOffsetChange,
}: ProfileCoverProps) {
  const [live, setLive] = useState(offset);
  const [dragging, setDragging] = useState(false);
  const band = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; from: number; moved: boolean } | null>(null);

  // Somebody else's cover, or our own after a save: follow the stored value.
  useEffect(() => {
    if (!dragging) setLive(offset);
  }, [offset, dragging]);

  const canMove = editable && Boolean(src);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!canMove) return;
    start.current = { y: e.clientY, from: live, moved: false };
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
    setLive(Math.max(0, Math.min(100, from.from - (dy / height) * 100)));
  };

  const onPointerUp = () => {
    const from = start.current;
    start.current = null;
    setDragging(false);
    if (!from) return;
    // A tap is not a reposition - it is somebody wanting to change the picture.
    if (!from.moved) onPick?.();
    else if (Math.round(live) !== Math.round(offset)) onOffsetChange?.(Math.round(live));
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
        'relative -mx-5 h-28 overflow-hidden bg-brand-wash sm:h-36',
        canMove && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full select-none object-cover"
          style={{ objectPosition: `50% ${live}%` }}
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-brand/25 to-brand/5" />
      )}

      {/*
        A scrim, always, not only over a photo.

        The avatar and the name sit on top of this, and a cover somebody chose
        is by definition a picture nobody vetted for contrast - a bright sky
        behind a light monogram is unreadable and there is no way to know in
        advance. Cheap, and it also stops the band competing with the face.
      */}
      <div className="absolute inset-0 bg-gradient-to-t from-page/70 via-page/10 to-transparent" />

      {editable ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPick?.();
          }}
          className={cn(
            'focus-ring absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full',
            'bg-surface/85 px-3 py-1.5 text-caption font-medium text-ink shadow-sm',
            'active:scale-[0.97]',
          )}
        >
          <CameraIcon size={15} />
          {src ? 'Change cover' : 'Add cover'}
        </button>
      ) : null}

      {canMove && !dragging ? (
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-surface/70 px-2.5 py-1 text-[11px] text-text-secondary">
          Drag to reposition
        </span>
      ) : null}
    </div>
  );
}
