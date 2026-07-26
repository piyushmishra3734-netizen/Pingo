import { cn } from '@pingo/ui';

/**
 * The official PINGO app icon.
 *
 * This renders `public/pingo-icon.png` — the supplied artwork, byte for byte.
 * It is **not** redrawn, recoloured, or reconstructed in SVG.
 *
 * That distinction matters, because the codebase also contains `PingoMark`, a
 * vector *approximation* of the same shape. Anywhere the finished icon belongs
 * — splash, onboarding, the sign-in screens — this component is the one to use.
 * `PingoMark` stays for the cases the icon cannot serve: tinting to a muted
 * colour in an empty state, or animating the dot.
 *
 * ## Why the artwork is clipped rather than edited
 *
 * The PNG is RGB with no alpha, so everything outside the rounded square is
 * **opaque white** — a white sheet that shows up as a pale box behind the icon
 * on any tinted background, which is most of this product.
 *
 * The fix is presentational: clip it in CSS and leave the file untouched. The
 * alternative, keying the white out to transparency, would have to guess where
 * the background ends and the artwork begins — and the artwork's own top-left is
 * near-white (#FDFDFE), so any threshold that removed the surround would eat
 * into the gradient too.
 *
 * Both numbers below were measured from the file rather than guessed:
 *
 * | | |
 * | --- | --- |
 * | White surround | 36px of 1254 ≈ **2.9%** per side |
 * | Corner radius | ~275px of the 1183px square ≈ **23.2%** |
 *
 * So the image is scaled 7% (cropping ~3.3% per side, comfortably past the
 * surround) and the box is rounded at 23.5% — a shade wider than the artwork's
 * own corner, so it trims a hair of gradient rather than leaving a white nick.
 */

export interface AppLogoProps {
  /** Rendered edge length in px. The artwork is square. */
  size?: number;
  /**
   * Empty string where a wordmark or heading already names the product —
   * otherwise a screen reader announces "PINGO" twice in a row.
   */
  alt?: string;
  className?: string;
}

export function AppLogo({ size = 72, alt = 'PINGO', className }: AppLogoProps) {
  return (
    <span
      className={cn('relative block shrink-0 overflow-hidden', className)}
      style={{ width: size, height: size, borderRadius: '23.5%' }}
    >
      <img
        src="/pingo-icon.png"
        alt={alt}
        /*
         * Both matter for a logo: dragging one out of the page is a stray
         * interaction nobody wants, and the browser's default selection
         * highlight on an image looks like a rendering fault.
         */
        draggable={false}
        className="absolute inset-0 h-full w-full select-none"
        style={{ transform: 'scale(1.07)' }}
      />
    </span>
  );
}
