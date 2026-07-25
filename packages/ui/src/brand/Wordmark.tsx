import { cn } from '../utils/cn.js';

/**
 * The PINGO wordmark.
 *
 * Set in the brand face at wide tracking, with the purple dot sitting above the
 * I as its tittle — the detail that ties the wordmark to the monogram and to
 * every dot state in the product.
 *
 * Rendered as text rather than an SVG outline so it stays selectable, scales with
 * the type system, and inherits colour. The three `tone` variants correspond to
 * the wordmark variations on the board.
 */

export interface WordmarkProps {
  /** Height of the lettering. Tracking and dot scale from this. */
  size?: number | string;
  /**
   * `ink` on light surfaces, `brand` for accent use, `inverse` on dark or
   * gradient backgrounds.
   */
  tone?: 'ink' | 'brand' | 'inverse';
  className?: string;
  /** Renders as an `h1`. Use once per screen at most. */
  as?: 'span' | 'h1';
}

const TONE_CLASS = {
  ink: 'text-ink',
  brand: 'text-brand',
  inverse: 'text-white',
} as const;

export function Wordmark({
  size,
  tone = 'ink',
  className,
  as: Tag = 'span',
}: WordmarkProps) {
  return (
    <Tag
      className={cn(
        'inline-flex items-baseline font-sans font-medium select-none',
        // 0.34em tracking reproduces the board's letterspacing.
        'tracking-[0.34em]',
        TONE_CLASS[tone],
        className,
      )}
      style={size ? { fontSize: typeof size === 'number' ? `${size}px` : size } : undefined}
      aria-label="PINGO"
    >
      <span aria-hidden>P</span>
      {/*
        The dot is centred on the I's glyph, not its advance width. Letter-spacing
        is appended to the right of each glyph, so `left-1/2` lands half a tracking
        unit too far right — hence the -0.17em correction (half of 0.34em).
      */}
      <span className="relative" aria-hidden>
        I
        <span
          className="absolute -top-[0.34em] left-1/2 -ml-[0.17em] -translate-x-1/2 rounded-full bg-dot"
          style={{ width: '0.17em', height: '0.17em' }}
        />
      </span>
      <span aria-hidden>NGO</span>
    </Tag>
  );
}

/**
 * The tagline that accompanies the wordmark on the splash and onboarding screens.
 * Kept beside it so the pairing, spacing and casing stay consistent.
 */
export function Tagline({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'font-sans text-caption font-medium uppercase text-brand/70',
        'tracking-[0.28em]',
        className,
      )}
    >
      Connect. Privately.
    </span>
  );
}
