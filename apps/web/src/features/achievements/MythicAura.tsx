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
 * ## Motion, and the one place it is allowed
 *
 * The wash drifts, extremely slowly - twenty-two seconds for a cycle that moves
 * it a few percent. That is under the threshold where the eye reads something
 * as animated; it reads as light that is not quite still. Under
 * `prefers-reduced-motion` it simply stops, and what is left is the same
 * gradient, which is a complete design on its own rather than a degraded one.
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
         * `-z-10` belongs to the component, not to each caller.
         *
         * The inner wash animates and is blurred, which promotes it to its own
         * compositing layer - and a composited layer is free to paint above
         * later, non-composited siblings. It did: on the mission screen the
         * emblem was in the DOM, loaded, opacity 1 and top of the hit-test
         * stack, with a soft glow on screen where it should have been. Nothing
         * errored, and it came and went between loads.
         *
         * The profile had the fix from the start and passed `-z-10` in by hand;
         * the two screens written later did not copy it, which is the argument
         * for it living here. Callers still owe it a stacking context of their
         * own - `isolate` on the screen root - or a negative index falls behind
         * the page background instead of behind the content.
         */
        'pointer-events-none absolute -z-10 inset-x-0 top-0 h-72 overflow-hidden',
        className,
      )}
    >
      <div
        className={cn(
          'absolute inset-0 blur-2xl',
          // Stops dead under reduced motion, and the gradient alone is the
          // design rather than a fallback for it.
          'motion-safe:animate-mythic-drift',
        )}
        style={{ background: ACCENT[accent]!.wash }}
      />
    </div>
  );
}
