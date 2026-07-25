import { cn } from '../utils/cn.js';
import { PingoMark } from './PingoMark.js';

/**
 * The PINGO app icon, in the four treatments shown on the board.
 *
 * `light` is the final icon: a soft near-white tile with a subtle brand wash, so
 * it reads as a physical object rather than a flat sticker. The others exist for
 * placement on surfaces the light tile would disappear against.
 *
 * The corner radius is a fixed *proportion* of the size (22%), which is what
 * keeps the silhouette identical whether the icon is 28px in a header or 512px
 * in a store listing.
 */

export type AppIconVariant = 'light' | 'gradient' | 'dark' | 'plain';

export interface AppIconProps {
  size?: number;
  variant?: AppIconVariant;
  className?: string;
  title?: string;
}

const SURFACE: Record<AppIconVariant, string> = {
  light: 'bg-brand-wash shadow-md',
  gradient: 'bg-brand-gradient shadow-brand',
  dark: 'bg-ink shadow-md',
  plain: 'bg-surface border border-line shadow-sm',
};

/** The mark's stroke has to flip to white on the two dark treatments. */
const MARK_STROKE: Record<AppIconVariant, string> = {
  light: 'text-brand',
  gradient: 'text-white',
  dark: 'text-white',
  plain: 'text-ink',
};

/** On the gradient tile the purple dot would vanish, so it becomes white. */
const MARK_DOT: Record<AppIconVariant, string> = {
  light: 'text-dot',
  gradient: 'text-white',
  dark: 'text-dot',
  plain: 'text-dot',
};

export function AppIcon({
  size = 64,
  variant = 'light',
  className,
  title,
}: AppIconProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center overflow-hidden',
        SURFACE[variant],
        className,
      )}
      style={{ width: size, height: size, borderRadius: size * 0.22 }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <PingoMark
        size={size * 0.58}
        strokeClassName={MARK_STROKE[variant]}
        dotClassName={MARK_DOT[variant]}
      />
    </span>
  );
}
