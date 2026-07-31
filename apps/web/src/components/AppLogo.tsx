import { cn } from '@pingo/ui';

/**
 * The official PINGO app icon.
 *
 * Renders `public/pingo-icon.png` - the supplied artwork, unmodified except
 * that the white sheet it was mounted on has been made transparent. Not
 * redrawn, not recoloured, not reconstructed in SVG.
 *
 * ## What changed, and why the component got smaller
 *
 * The supplied PNG is RGB with no alpha, so everything outside the rounded
 * square was opaque white - a pale box behind the icon on any tinted surface,
 * which is most of this product. It used to be hidden here: scale the image 7%
 * to crop past the surround, and round the box at 23.5% to fake the corner.
 *
 * That worked, and it was a compensation living at the call site rather than a
 * fix. `pnpm build:logo … tile` now bakes the alpha into the file with a
 * rounded-rectangle mask at the artwork's own measured inset and radius, so the
 * image is simply correct and this component is simply an `<img>`.
 *
 * The alpha has to be generated geometrically rather than keyed out of the
 * pixels: the surround is white and the artwork's own top corner is #FDFDFE, so
 * no threshold can separate them without eating into the gradient.
 *
 * `PingoMark` remains for the one thing a raster cannot do - taking a colour,
 * as in a muted empty state.
 */

export interface AppLogoProps {
  /** Rendered edge length in px. The artwork is square. */
  size?: number;
  /**
   * Empty string where a wordmark or heading already names the product  - 
   * otherwise a screen reader announces "PINGO" twice in a row.
   */
  alt?: string;
  className?: string;
  /**
   * Hint for LCP on public hero placements. Defaults to browser behaviour
   * (`auto`); marketing heroes pass `high`.
   */
  fetchPriority?: 'high' | 'low' | 'auto';
}

export function AppLogo({
  size = 72,
  alt = 'PINGO',
  className,
  fetchPriority = 'auto',
}: AppLogoProps) {
  return (
    <img
      src="/pingo-icon.png"
      alt={alt}
      width={size}
      height={size}
      decoding="async"
      fetchPriority={fetchPriority}
      /*
       * Both matter for a logo: dragging one out of the page is a stray
       * interaction nobody wants, and the browser's default selection
       * highlight on an image looks like a rendering fault.
       */
      draggable={false}
      className={cn('block shrink-0 select-none', className)}
      style={{ width: size, height: size }}
    />
  );
}
