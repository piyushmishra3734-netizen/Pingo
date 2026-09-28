import type { StoryFrame } from '@pingo/core';

/**
 * Where a story's photo or video sits in the frame, and what is behind it.
 *
 * A picture from the gallery is rarely the shape of a story. It used to be
 * stretched to cover the frame - cropped wherever it happened to be cropped,
 * with no way to move it - so a landscape photo lost its sides and a screenshot
 * lost its top and bottom. Now it starts fitted inside the frame over a wash of
 * its own colours, the way Instagram does it, and can be pinched and dragged
 * to wherever it looks right.
 *
 * The editor, the exported photo and the viewer all place it with the same
 * sums from the same three numbers, so what is posted is what was arranged:
 *
 *   - `s`: the size, where 1 is "fitted inside the frame"
 *   - `x`, `y`: how far the centre has moved, as fractions of the frame
 */

export interface Box {
  width: number;
  height: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The media's rectangle inside a frame of this size. */
export function framedRect(stage: Box, media: Box, frame: Pick<StoryFrame, 'x' | 'y' | 's'>): Rect {
  const fit = Math.min(stage.width / media.width, stage.height / media.height);
  const width = media.width * fit * frame.s;
  const height = media.height * fit * frame.s;
  return {
    left: stage.width / 2 + frame.x * stage.width - width / 2,
    top: stage.height / 2 + frame.y * stage.height - height / 2,
    width,
    height,
  };
}

/** The size at which the media just covers the frame, in the same units as `s`. */
export function coverScale(stage: Box, media: Box): number {
  const fit = Math.min(stage.width / media.width, stage.height / media.height);
  const cover = Math.max(stage.width / media.width, stage.height / media.height);
  return cover / fit;
}

/**
 * Where a new photo or video starts.
 *
 * Something already nearly the frame's shape - anything the camera took - fills
 * it, as it always did. Anything else is shown whole, over its colours, and it
 * is for the person to decide what to crop.
 */
export function initialFrame(stage: Box, media: Box): StoryFrame {
  const cover = coverScale(stage, media);
  return { x: 0, y: 0, s: cover < 1.15 ? cover : 1 };
}

export const SCALE_MIN = 0.35;
export const SCALE_MAX = 5;

/**
 * Two colours from the picture, for the wash behind it: roughly its top and
 * its bottom, darkened a little so white text and stickers still read on top.
 * Falls back to graphite when the pixels cannot be read.
 */
export function paletteOf(source: CanvasImageSource): [string, string] {
  try {
    const c = document.createElement('canvas');
    c.width = 6;
    c.height = 12;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('no context');
    g.drawImage(source, 0, 0, c.width, c.height);
    const { data } = g.getImageData(0, 0, c.width, c.height);
    const band = (from: number, to: number) => {
      let r = 0, gr = 0, b = 0, n = 0;
      for (let y = from; y < to; y += 1) {
        for (let x = 0; x < c.width; x += 1) {
          const i = (y * c.width + x) * 4;
          r += data[i]!; gr += data[i + 1]!; b += data[i + 2]!; n += 1;
        }
      }
      const k = 0.72 / n;
      return `rgb(${Math.round(r * k)}, ${Math.round(gr * k)}, ${Math.round(b * k)})`;
    };
    return [band(0, 4), band(8, 12)];
  } catch {
    return ['#3a3a40', '#1c1c1e'];
  }
}

export function washOf(colours: [string, string] | undefined): string {
  const [a, b] = colours ?? ['#3a3a40', '#1c1c1e'];
  return `linear-gradient(180deg, ${a}, ${b})`;
}
