import { cn } from '../utils/cn.js';

/**
 * Waiting — three soft dots. Quiet, Linear-adjacent, no spinner costume.
 *
 * Staggered rise (ease-out feel via cubic-bezier keyframes). Transform +
 * opacity only. Reduced motion: three static dots.
 */

export interface PingoLoaderProps {
  /** Diameter of each dot in px. */
  size?: number;
  label?: string;
  className?: string;
}

export function PingoLoader({ size = 7, label = 'Loading', className }: PingoLoaderProps) {
  /*
   * `size` used to mean the whole glyph. Callers pass ~44–52 for full-area
   * loaders. Map that to a calm three-dot row rather than a giant single blob.
   */
  const dot = size > 16 ? Math.max(6, Math.round(size * 0.145)) : size;
  const gap = Math.max(5, Math.round(dot * 0.9));

  return (
    <span
      role="status"
      aria-label={label}
      className={cn('inline-flex items-center justify-center', className)}
      style={{ gap }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            /* brand/dot so Appearance accent retints the wait mark */
            'block rounded-full bg-brand',
            'motion-safe:animate-loader-dot motion-reduce:opacity-35',
          )}
          style={{
            width: dot,
            height: dot,
            animationDelay: `${i * 140}ms`,
          }}
        />
      ))}
    </span>
  );
}
