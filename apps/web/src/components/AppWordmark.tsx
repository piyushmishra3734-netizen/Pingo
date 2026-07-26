import { cn } from '@pingo/ui';
import type { ElementType } from 'react';

/**
 * The official PINGO wordmark.
 *
 * Renders `public/pingo-wordmark.png`, derived from the supplied artwork. The
 * letterforms and the purple dot are untouched — the only change is that the
 * background is now transparent.
 *
 * The alternative in `@pingo/ui`, `Wordmark`, sets the word in Space Grotesk with
 * letter-spacing. That is a *typographic imitation* of the mark, and it drifts
 * the moment the font loads late or a platform substitutes. This is the mark
 * itself.
 *
 * ## How the background was removed
 *
 * The source is a JPEG, so it has no alpha and the word sits on a near-white
 * ground (`#FEFEFE`) — a pale slab on every tinted surface in the product.
 * Unlike the app icon, this could not be fixed by clipping: a wordmark's
 * background is *between* the letters, not just around them.
 *
 * So the file was converted once, at build time, not at runtime:
 *
 * 1. The ground was sampled from a corner and levelled to pure white.
 * 2. Alpha was recovered per pixel as `255 - min(r, g, b)`, then the colour was
 *    un-composited from white. That is exact for artwork drawn on white, and it
 *    keeps antialiased edges genuinely soft rather than stair-stepped — which a
 *    colour-key threshold would not.
 * 3. The result was cropped to the artwork plus 6px, so layout can position it
 *    by its real bounds instead of guessing at padding.
 *
 * `mix-blend-mode: multiply` would have hidden the ground without touching the
 * file, and was rejected: it only works while every surface behind the mark
 * stays light, so it would fail the day a dark theme lands.
 */

/** Intrinsic size of the generated PNG, used to hold the aspect ratio. */
const NATURAL_WIDTH = 1269;
const NATURAL_HEIGHT = 225;

export interface AppWordmarkProps {
  /** Rendered height in px. Width follows the artwork's own ratio. */
  height?: number;
  /** Wraps the image — `h1` where the wordmark is the screen's title. */
  as?: ElementType;
  className?: string;
}

export function AppWordmark({ height = 20, as: Wrapper = 'span', className }: AppWordmarkProps) {
  return (
    <Wrapper className={cn('inline-flex items-center', className)}>
      <img
        src="/pingo-wordmark.png"
        alt="PINGO"
        height={height}
        width={Math.round((height * NATURAL_WIDTH) / NATURAL_HEIGHT)}
        draggable={false}
        className="block select-none"
        style={{ height, width: 'auto' }}
      />
    </Wrapper>
  );
}
