import type { SVGProps } from 'react';

import { cn } from '../utils/cn.js';

/**
 * The base every PINGO icon is drawn on.
 *
 * The branding board specifies one icon style - rounded, 2px stroke, minimal,
 * consistent - so those properties are set here once rather than repeated on
 * every glyph. Individual icons supply geometry only, which is what guarantees
 * they stay consistent as the set grows.
 *
 * Icons inherit `currentColor` and are `aria-hidden` by default: an icon beside
 * a label would otherwise be announced twice. Pass a `title` for the rare
 * standalone icon that carries meaning on its own.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /**
   * Nominal size in px. 20 for inline, 24 for controls, 28 for the dock.
   *
   * What is drawn is a tenth larger - see `SCALE` below. The numbers here stay
   * the design's own scale so call sites keep saying what they mean.
   */
  size?: number;
  /** Accessible name. Supplying it also removes `aria-hidden`. */
  title?: string;
}

interface IconBaseProps extends IconProps {
  children: React.ReactNode;
}

/**
 * Everything drawn a tenth larger than it asks for.
 *
 * The set was specified at 20 inline / 24 control / 28 dock and, in place, all
 * of it read a shade small - the microphone, the call and video buttons, the
 * overflow dots, the search glass. Not wrong individually; collectively the
 * chrome looked underweight against the type beside it.
 *
 * Applied here rather than by editing the call sites. There are around two
 * hundred and fifty explicit sizes across twenty distinct values, and changing
 * them by hand would be a large diff, would certainly miss some, and would
 * flatten the deliberate hierarchy between them - a 14px badge glyph is
 * supposed to be smaller than a 24px control, and it still is. One factor
 * keeps every one of those relationships and moves the whole set together.
 *
 * A tenth is chosen to be felt rather than noticed: 20 becomes 22, 24 becomes
 * 26. Anything more and glyphs start crowding the 44px hit targets they sit in.
 */
const SCALE = 1.1;

export function IconBase({
  size = 24,
  title,
  className,
  children,
  ...rest
}: IconBaseProps) {
  const drawn = Math.round(size * SCALE);

  return (
    <svg
      width={drawn}
      height={drawn}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Keeps stroke weight optically even when the icon is scaled.
      vectorEffect="non-scaling-stroke"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}
