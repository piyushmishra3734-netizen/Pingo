import { cn } from '@pingo/ui';
import type { MythicAccent } from '@pingo/core';

/**
 * The light on a rare profile, and the accent that goes with it.
 *
 * ## What "subtle" had to mean here
 *
 * The brief for this layer is prestige without noise, and the test that keeps
 * it honest is simple: with the aura on and off, every word on the profile has
 * to be exactly as easy to read. So this never sits over content - it is one
 * wash behind the top of the page, at low opacity, with the page's own
 * background still doing the work underneath. Nothing tints text, nothing
 * overlays a button, and there is no border, ring or frame anywhere.
 *
 * It is also why there are no particles. A field of drifting sparks is the
 * fastest way to make a private messenger feel like a game, and it costs a
 * repainting layer on a phone for the whole time somebody is reading.
 *
 * ## The drift and the blur are gone, and the badge is why
 *
 * The wash used to drift over twenty-two seconds and sit under a `blur-2xl`.
 * Both are compositing promoters, and a promoted layer is not obliged to honour
 * the order it was given: on the mission screen, whose emblem sits inside this
 * wash's band, the emblem was in the DOM, loaded, at full opacity - and not on
 * screen. Intermittently, so it survived more than one look. `-z-10` on this
 * container and `isolate` on the screen root did not stop it, because the
 * promoted element was the child inside them.
 *
 * What stops it is not making a layer at all. Verified rather than reasoned:
 * with the filter and the animation removed, the emblem still paints when this
 * element is *forced* onto its own layer with `will-change` - which is the test
 * that a lucky reload is not.
 *
 * Nothing was lost that this file had not already conceded. It argued that
 * under `prefers-reduced-motion` "what is left is the same gradient, which is a
 * complete design on its own rather than a degraded one", and that is now what
 * everybody gets. The blur was smoothing a radial gradient that already fades
 * to transparent, and a filter running behind a whole screen is not free on a
 * phone.
 */

/** Three accents, and each is a pair: the wash, and the tint UI details borrow. */
const ACCENT: Record<MythicAccent, { wash: string; tint: string }> = {
  aurora: {
    wash: 'radial-gradient(60% 45% at 50% 0%, rgba(124,92,255,0.20), rgba(80,180,255,0.12) 45%, transparent 72%)',
    tint: 'rgba(124,92,255,0.65)',
  },
  gold: {
    wash: 'radial-gradient(60% 45% at 50% 0%, rgba(226,170,70,0.22), rgba(255,214,140,0.12) 45%, transparent 72%)',
    tint: 'rgba(214,158,60,0.70)',
  },
  prism: {
    wash: 'radial-gradient(60% 45% at 50% 0%, rgba(255,150,200,0.18), rgba(140,200,255,0.14) 40%, rgba(190,150,255,0.10) 60%, transparent 74%)',
    tint: 'rgba(196,140,235,0.68)',
  },
};

/**
 * The accent a Mythic profile lends to its own details.
 *
 * Returned as a CSS custom property rather than applied to anything, so the
 * places that use it opt in - a separator here, an active state there - and the
 * rest of PINGO stays exactly the colour it was. Recolouring the product would
 * be the opposite of rare: it would make every screen look like the badge.
 */
export function mythicAccentStyle(accent: MythicAccent): React.CSSProperties {
  return { ['--mythic-accent' as string]: ACCENT[accent]!.tint };
}

export function MythicAura({
  accent,
  className,
}: {
  accent: MythicAccent;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        /*
         * One element, and `-z-10` on the element that draws.
         *
         * There used to be a wrapper here and a blurred, animated child inside
         * it. That is what made this thing eat the badge: the negative index was
         * on the wrapper and the layer was the child, so the ordering was being
         * asked of something that was not the thing being reordered. With the
         * filter and the animation gone there is nothing to nest, and the index
         * lands where the paint happens.
         *
         * `-z-10` belongs to the component rather than to each caller. The
         * profile passed it in by hand from the start; the two screens written
         * afterwards did not copy it, which is the argument for it living here.
         * Callers still owe it a stacking context of their own - `isolate` on
         * the screen root - or a negative index falls behind the page
         * background instead of behind the content.
         */
        'pointer-events-none absolute -z-10 inset-x-0 top-0 h-72 overflow-hidden',
        className,
      )}
      style={{ background: ACCENT[accent]!.wash }}
    />
  );
}
