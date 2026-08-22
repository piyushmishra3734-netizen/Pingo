import { cn } from '@pingo/ui';
import type { MythicAura } from '@pingo/core';

import type { Achievement } from './registry.js';

/**
 * How an achievement is drawn, at every size the product needs.
 *
 * ## One component, because there is only one artwork
 *
 * The emblem was designed and handed over finished. Nothing here recolours it,
 * simplifies it, or swaps in a glyph when it gets small - the only decisions
 * are which of its two crops to use and how much room to give it. Beside a name
 * that is the crest, because at twenty-four pixels the full emblem's wreath and
 * banner are grey smudges; anywhere with room it is the emblem itself.
 *
 * ## The aura is the one thing a person chose
 *
 * Three washes, all static. Motion belongs to the moment something is unlocked,
 * and a badge that shimmers on a profile all day spends the surprise that
 * moment is saving - so what is offered here is a colour of light, not an
 * animation. Reduced-motion has nothing to turn off because nothing moves.
 */

/** The light behind an emblem. Kept out of the component so it can be read alone. */
const AURA: Record<MythicAura, string> = {
  classic:
    'radial-gradient(closest-side, color-mix(in srgb, var(--gradient-from, #7c5cff) 55%, transparent), transparent 70%)',
  /*
   * Three stops rather than a hue rotation: iridescence is the *disagreement*
   * between colours at the edges, and a single hue faded out is just a glow.
   */
  iridescent:
    'radial-gradient(closest-side, rgba(120,190,255,0.55), rgba(190,140,255,0.40) 45%, rgba(255,170,220,0.22) 65%, transparent 78%)',
  gold: 'radial-gradient(closest-side, rgba(255,205,110,0.60), rgba(226,160,60,0.30) 55%, transparent 74%)',
};

export interface AchievementArtProps {
  achievement: Achievement;
  /** `mark` sits beside a name; `hero` is the subject of the screen. */
  size?: 'mark' | 'small' | 'medium' | 'large';
  aura?: MythicAura;
  /** Dimmed, for an achievement on show but not yet earned. */
  locked?: boolean;
  className?: string;
}

const BOX = {
  mark: 'size-4',
  small: 'size-9',
  medium: 'size-20',
  large: 'size-40 sm:size-56',
} as const;

export function AchievementArt({
  achievement,
  size = 'medium',
  aura,
  locked = false,
  className,
}: AchievementArtProps) {
  const src = size === 'mark' ? achievement.art.crest : achievement.art.emblem;

  const image = (
    <img
      src={src}
      alt=""
      aria-hidden
      /*
       * Small art is beside content already on screen and is a few kilobytes;
       * the full emblem is worth deferring until the screen it belongs to is
       * actually open.
       */
      loading={size === 'large' ? 'lazy' : 'eager'}
      decoding="async"
      draggable={false}
      className={cn(
        BOX[size],
        'relative shrink-0 object-contain select-none',
        locked && 'opacity-40',
        className,
      )}
    />
  );

  if (!aura || locked || size === 'mark') return image;

  return (
    <span className="relative inline-grid place-items-center">
      {/*
        Behind the artwork and wider than it, so the light appears to come off
        the emblem rather than to be a shape sitting under it. Blurred rather
        than drawn - an edge here would read as a second object.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute size-[150%] rounded-full opacity-45 blur-2xl"
        style={{ background: AURA[aura] }}
      />
      {image}
    </span>
  );
}

/**
 * The mark beside a name, with the label a screen reader needs.
 *
 * The image itself is `aria-hidden` and the meaning lives in text, so an
 * achievement is never something only sighted users can perceive. Rendered as
 * nothing at all when there is nothing to show, so every caller can ask
 * unconditionally.
 */
export function AchievementMark({
  achievement,
  className,
}: {
  achievement: Achievement | undefined;
  className?: string;
}) {
  if (!achievement) return null;
  return (
    <span className={cn('inline-flex shrink-0 items-center', className)}>
      <AchievementArt
        achievement={achievement}
        size="mark"
        className={cn('translate-y-[0.5px]', className)}
      />
      <span className="sr-only">{achievement.title} achievement</span>
    </span>
  );
}
