import { cn } from '../utils/cn.js';

/**
 * The PINGO monogram: a monoline P with the purple dot detached at its shoulder.
 *
 * Drawn as strokes rather than filled outlines so a single `strokeWidth` keeps
 * the mark optically correct at every size — the same reason the icon set is
 * stroke-based. The dot is a separate element because it is the brand's living
 * part: `PingoMarkState` animates it without touching the letter.
 */

export interface PingoMarkProps {
  size?: number;
  className?: string;
  /** Colour of the P itself. Defaults to the current text colour. */
  strokeClassName?: string;
  /** Colour of the dot. Defaults to brand purple — override only on dark chips. */
  dotClassName?: string;
  /** Hide the dot when a state component is rendering its own. */
  hideDot?: boolean;
  title?: string;
}

/** Geometry, shared so the animated states can position a dot over the letter. */
export const markGeometry = {
  viewBox: '0 0 44 44',
  strokeWidth: 3.4,
  stem: 'M 11 10 V 34',
  bowl: 'M 11 10 H 18 C 22.4 10 26 13.1 26 17 C 26 20.9 22.4 24 18 24 H 11',
  dot: { cx: 32, cy: 10.5, r: 3.4 },
} as const;

export function PingoMark({
  size = 44,
  className,
  strokeClassName = 'text-ink',
  dotClassName = 'text-dot',
  hideDot = false,
  title,
}: PingoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={markGeometry.viewBox}
      fill="none"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <g
        className={strokeClassName}
        stroke="currentColor"
        strokeWidth={markGeometry.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={markGeometry.stem} />
        <path d={markGeometry.bowl} />
      </g>
      {hideDot ? null : (
        <circle
          className={dotClassName}
          cx={markGeometry.dot.cx}
          cy={markGeometry.dot.cy}
          r={markGeometry.dot.r}
          fill="currentColor"
        />
      )}
    </svg>
  );
}
