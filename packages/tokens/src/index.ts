/**
 * @pingo/tokens — the PINGO design system, expressed as data.
 *
 * The branding board is the source of truth; this package is its machine-readable
 * form. Two consumers, one definition:
 *
 *   - Web  → `@pingo/tokens/css` (Tailwind v4 `@theme`)
 *   - Native → these TypeScript objects, once apps/mobile exists
 *
 * If a value needs to change, it changes here and nowhere else.
 */

export { palette, gradient, color, type ColorRole } from './color.js';
export {
  fontFamily,
  fontWeight,
  textStyle,
  type TextStyleName,
} from './typography.js';
export { space, radius, shadow, glass, layout, zIndex, breakpoint } from './layout.js';
export { duration, easing, transition, press } from './motion.js';
