import type { VideoOverlayItem } from '@pingo/core';
import { cn } from '@pingo/ui';
import { useEffect, useState, type RefObject } from 'react';

/**
 * What somebody put on a video, put back at playback.
 *
 * ## Sized against the frame, not in pixels
 *
 * A sticker placed at 96px on a phone would be 96px on a laptop too - a third
 * of the picture in one place and a stamp in the other. The sizes here are
 * container units (`cqh`), a fraction of the video's own height, so the same
 * numbers describe the same picture on every screen. That is also why the layer
 * declares `container-type: size`: it is the thing the fractions are of.
 *
 * ## The layer is the video's frame, not the screen
 *
 * Positions are normalised to the picture. A video letterboxed inside a tall
 * phone screen has black above and below it, and an item at y=0.5 belongs in
 * the middle of the *video*, not the middle of the screen. So both the editor
 * and the viewer put this layer over a box shaped like the video and let the
 * black fall outside it.
 */

/**
 * Item sizes, as a fraction of the frame's height.
 *
 * Shared with the editor so what you place is the size it arrives - and the
 * same fractions the photo export paints with, so a sticker on a video and the
 * same sticker on a photo are the same sticker.
 */
export const OVERLAY_SIZE = {
  text: '5.2cqh',
  emoji: '12cqh',
  sticker: '18cqh',
} as const;

/**
 * The rectangle a video actually occupies inside a box, measured.
 *
 * `object-contain` letterboxes, and nothing in CSS hands back the size of what
 * is left after it does - which is the one number both the editor and the
 * player need, because it is the surface the stickers were placed on. Doing it
 * by hand is four lines of arithmetic and is exact at every screen size; the
 * CSS routes to the same answer all rely on how a browser chooses to transfer
 * a max-height through an aspect ratio, and a sticker landing off the face is
 * too visible a way to find out that it chose differently.
 *
 * Returns nothing until the video's own proportions are known, which is what
 * the caller should render the plain letterboxed video for.
 */
export function useContainBox(
  host: RefObject<HTMLElement | null>,
  ratio: number | undefined,
): { width: number; height: number } | undefined {
  const [box, setBox] = useState<{ width: number; height: number }>();

  useEffect(() => {
    const element = host.current;
    if (!element || !ratio || !Number.isFinite(ratio)) {
      setBox(undefined);
      return;
    }

    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      setBox({
        width: Math.min(width, height * ratio),
        height: Math.min(height, width / ratio),
      });
    };

    measure();
    // Rotating the phone, the keyboard opening, a sheet resizing the stage.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [host, ratio]);

  return box;
}

export function VideoOverlayLayer({
  items,
  className,
}: {
  items: VideoOverlayItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <div
      aria-hidden
      // Never in the way: every tap here belongs to the story pager underneath.
      className={cn('pointer-events-none absolute inset-0', className)}
      style={{ containerType: 'size' }}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className="absolute"
          style={{
            left: `${item.x * 100}%`,
            top: `${item.y * 100}%`,
            transform: `translate(-50%, -50%) rotate(${item.rotation}rad) scale(${item.scale})`,
          }}
        >
          {item.kind === 'text' && (
            <span
              style={{ color: item.colour, fontSize: OVERLAY_SIZE.text }}
              className="block rounded-[0.36em] bg-black/40 px-[0.42em] py-[0.3em] leading-tight font-semibold"
            >
              {item.value}
            </span>
          )}

          {item.kind === 'emoji' && (
            <span style={{ fontSize: OVERLAY_SIZE.emoji }} className="block leading-none">
              {item.value}
            </span>
          )}

          {item.kind === 'sticker' && item.url && (
            <img
              src={item.url}
              alt=""
              draggable={false}
              style={{ height: OVERLAY_SIZE.sticker }}
              className="w-auto max-w-none object-contain"
            />
          )}
        </div>
      ))}
    </div>
  );
}
