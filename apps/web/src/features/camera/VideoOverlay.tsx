import type { VideoEdit, VideoOverlayItem, VideoOverlayStroke } from '@pingo/core';
import { cn } from '@pingo/ui';
import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

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

/** Stroke width as a fraction of the picture's smaller side, so it scales. */
export const PEN_WIDTH = 0.008;

/**
 * How a turned and cropped clip is fitted into a box, in three flat numbers.
 *
 * Turning and cropping a video means turning and cropping *what is shown*: the
 * file is never rewritten, so the player has to reproduce both from the marks.
 * Both the editor and the viewer need exactly the same arithmetic - if they
 * disagree by a percent, everything placed on the picture is off by a percent -
 * so it is written once, here, and neither one owns it.
 *
 * `picture` is the whole turned clip, positioned so the crop rectangle lands
 * over the frame; `video` is the element inside it, turned about its centre and
 * given swapped sides on a quarter turn because that is what a turn does to a
 * rectangle.
 */
export function videoGeometry(
  box: { width: number; height: number },
  rotate: number = 0,
  crop?: VideoEdit['crop'],
): { picture: CSSProperties; video: CSSProperties } {
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const pictureWidth = box.width / c.w;
  const pictureHeight = box.height / c.h;
  const turned = rotate % 180 !== 0;

  return {
    picture: {
      position: 'absolute',
      left: -c.x * pictureWidth,
      top: -c.y * pictureHeight,
      width: pictureWidth,
      height: pictureHeight,
    },
    video: {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: turned ? pictureHeight : pictureWidth,
      height: turned ? pictureWidth : pictureHeight,
      transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
      objectFit: 'contain',
    },
  };
}

/**
 * The shape of the picture after it has been turned and cropped.
 *
 * What the contain-box is measured against: a portrait clip turned sideways is
 * a landscape picture, and a clip cropped square is a square one.
 */
export function pictureRatio(
  ratio: number,
  rotate: number = 0,
  crop?: VideoEdit['crop'],
): number {
  const turned = (rotate % 180 !== 0 ? 1 / ratio : ratio);
  return crop ? (turned * crop.w) / crop.h : turned;
}

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
  strokes = [],
  width,
  height,
  className,
}: {
  items: VideoOverlayItem[];
  strokes?: VideoOverlayStroke[];
  /** The picture's size in pixels - what the drawn lines are measured in. */
  width: number;
  height: number;
  className?: string;
}) {
  if (items.length === 0 && strokes.length === 0) return null;

  return (
    <div
      aria-hidden
      // Never in the way: every tap here belongs to the story pager underneath.
      className={cn('pointer-events-none absolute inset-0', className)}
      style={{ containerType: 'size' }}
    >
      {/*
        The pen, in vectors.

        Drawn into an SVG sized in the picture's own pixels rather than a square
        stretched to fit, because a stretched viewBox turns a round pen into an
        oval one and every line drawn on a portrait clip would come out thinner
        across than along.
      */}
      {strokes.length > 0 && (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="absolute inset-0"
        >
          {strokes.map((stroke, index) => (
            <polyline
              key={index}
              stroke={stroke.colour}
              strokeWidth={PEN_WIDTH * Math.min(width, height)}
              points={stroke.points
                .map((point) => `${point.x * width},${point.y * height}`)
                .join(' ')}
            />
          ))}
        </svg>
      )}

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
