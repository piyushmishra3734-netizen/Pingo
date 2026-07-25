import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Class composition for PINGO.
 *
 * `twMerge` has to be taught our theme. Out of the box it recognises Tailwind's
 * stock scale, so `text-sm` is a font size — but it has no way to know that
 * `text-body` is one too. It falls back to reading `text-body` as a *colour*,
 * decides it conflicts with `text-white`, and drops the colour. The visible
 * result is white labels turning near-black on the gradient button, and captions
 * silently rendering at body size.
 *
 * Registering the type scale as literal members of the `font-size` group fixes
 * both directions: exact matches take priority over the catch-all colour
 * validator, so `text-caption text-brand` now means what it says.
 *
 * Any new `--text-*` token added to the theme must be added here too.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // Mirrors the --text-* tokens in @pingo/tokens.
      'font-size': [{ text: ['display', 'h1', 'h2', 'body', 'caption'] }],
    },
  },
});

/**
 * Compose class names, letting later Tailwind utilities win over earlier ones.
 *
 * Without the merge step, a `className` prop passed into a component would sit
 * alongside the component's own classes and lose to whichever CSS rule happened
 * to be declared later. With it, the call site reliably overrides the default —
 * which is what makes these components safe to reuse.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
