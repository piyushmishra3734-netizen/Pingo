import type { SVGProps } from 'react';

import { cn } from '../utils/cn.js';

/**
 * The base every PINGO icon is drawn on.
 *
 * The branding board specifies one icon style — rounded, 2px stroke, minimal,
 * consistent — so those properties are set here once rather than repeated on
 * every glyph. Individual icons supply geometry only, which is what guarantees
 * they stay consistent as the set grows.
 *
 * Icons inherit `currentColor` and are `aria-hidden` by default: an icon beside
 * a label would otherwise be announced twice. Pass a `title` for the rare
 * standalone icon that carries meaning on its own.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Rendered size in px. 20 for inline, 24 for controls, 28 for the dock. */
  size?: number;
  /** Accessible name. Supplying it also removes `aria-hidden`. */
  title?: string;
}

interface IconBaseProps extends IconProps {
  children: React.ReactNode;
}

export function IconBase({
  size = 24,
  title,
  className,
  children,
  ...rest
}: IconBaseProps) {
  return (
    <svg
      width={size}
      height={size}
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
