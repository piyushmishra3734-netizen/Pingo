import { cn } from '@pingo/ui';

/**
 * The PINGO mark: the looped P, in the sweep.
 *
 * `public/pingo-mark.svg`, generated from `brand/pingo-mark.svg` by
 * `scripts/icons.mjs` - the same file as the tab icon and the splash, so the
 * logo is one picture everywhere it appears.
 *
 * `tile` puts it on the white app-icon tile, for the places that are talking
 * about the app as a thing you install (the install banner, the download page).
 * Everywhere else the mark stands on its own.
 */

export interface AppLogoProps {
  /** Rendered edge length in px. The mark is square. */
  size?: number;
  /**
   * Empty string where a wordmark or heading already names the product -
   * otherwise a screen reader announces "PINGO" twice in a row.
   */
  alt?: string;
  className?: string;
  /** On the white app-icon tile. */
  tile?: boolean;
  /** Hint for LCP on public hero placements. */
  fetchPriority?: 'high' | 'low' | 'auto';
}

export function AppLogo({ size = 72, alt = 'PINGO', className, tile = false, fetchPriority = 'auto' }: AppLogoProps) {
  const mark = (
    <img
      src="/pingo-mark.svg"
      alt={tile ? '' : alt}
      width={tile ? Math.round(size * 0.72) : size}
      height={tile ? Math.round(size * 0.72) : size}
      decoding="async"
      fetchPriority={fetchPriority}
      draggable={false}
      className={cn('block shrink-0 select-none', !tile && className)}
      style={tile ? { width: '72%', height: '72%' } : { width: size, height: size }}
    />
  );
  if (!tile) return mark;
  return (
    <span
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      className={cn('grid shrink-0 place-items-center bg-white shadow-[0_1px_3px_rgba(17,17,19,.14)]', className)}
      style={{ width: size, height: size, borderRadius: size * 0.225 }}
    >
      {mark}
    </span>
  );
}
