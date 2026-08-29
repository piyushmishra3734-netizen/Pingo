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
 * ## It is a background now, and it stopped eating the badge
 *
 * This was an absolutely-positioned element behind the content. It kept
 * painting *over* the content instead - the MYTHIC emblem sits inside its
 * 288-pixel band on two screens, and on both the emblem was in the DOM, loaded,
 * at full opacity, and not on screen. Three fixes were tried and each looked
 * right until the next reload: a negative z-index on the element, `isolate` on
 * the screen root, then dropping the `blur` and the drift animation that were
 * promoting it to its own compositing layer.
 *
 * The mistake was arguing about paint order at all. A stacking context is a
 * thing a browser can be persuaded to reorder; a background is not. So the wash
 * is now a `background-image` on the screen's own root, which CSS paints above
 * the background colour and below every descendant, always, with nothing to
 * promote and nothing to sort. `mythicWashStyle` is the whole component.
 *
 * The drift and the blur stayed gone. This file had already conceded them,
 * arguing that under `prefers-reduced-motion` "what is left is the same
 * gradient, which is a complete design on its own rather than a degraded one" -
 * and the blur was smoothing a radial gradient that already fades to
 * transparent.
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

/**
 * The wash, as the screen root's own background.
 *
 * Spread onto the element that already carries `bg-page`: a background image
 * paints above the background colour and below every descendant, which is
 * exactly where this belongs and is not negotiable by a compositor. See the
 * header for the three attempts that came before it.
 *
 * 18rem is the 288 pixels the old element was tall, and `no-repeat` plus a top
 * anchor keeps it a band at the head of the page rather than a tile.
 */
export function mythicWashStyle(accent: MythicAccent): React.CSSProperties {
  return {
    backgroundImage: ACCENT[accent]!.wash,
    backgroundRepeat: 'no-repeat',
    backgroundSize: '100% 18rem',
    backgroundPosition: 'top center',
  };
}
