/**
 * One badge, as the reference draws it.
 *
 * ## The frame carries the colour, the artwork never does
 *
 * A badge is a disc — or, for three of them, a rounded square — filled either
 * with ink or with paper. The artwork inside is a single `currentColor` path
 * set, so the same drawing serves both fills and neither can drift from the
 * other. An accent, where the sheet gives one, replaces that colour and nothing
 * else: it does not tint the frame, add a glow, or change the shape.
 *
 * ## Rarity is a dot
 *
 * Not a border, not a gradient, not a bigger badge. One small mark outside the
 * frame, in a muted tone, which a person can learn without it ever competing
 * with the drawing. Gaming badges shout rarity; this library labels it.
 *
 * ## Locked is quiet, not sad
 *
 * A locked badge keeps its artwork and loses its contrast. Greying it into a
 * silhouette would turn the grid into a list of things you have failed to do,
 * when the point of showing them at all is that they are somewhere to go.
 */
import { cn } from '@pingo/ui';

import { BadgeArt, type BadgeArtId } from './BadgeArt.js';
import type { BadgeDefinition, BadgeRarity } from './registry.js';

/**
 * The sheet's two papers. Warm, not white; near-black, not black.
 *
 * Ink is lifted a little off the reference's own value. On the printed sheet a
 * near-black disc reads because the paper around it is a different near-black
 * and there is texture between them; in the app it sat on a dark page and
 * disappeared, leaving the artwork floating with no badge under it. Since the
 * sheet is a sheet *of discs*, the disc has to survive — so ink is raised just
 * far enough to separate, and a hairline ring does the rest.
 */
const INK = 'var(--badge-ink)';
const PAPER = 'var(--badge-paper)';
/** Only on ink — paper separates from the page by itself. */
const INK_EDGE = 'var(--badge-edge)';

/**
 * The rarity dot.
 *
 * Common has none. A dot on every badge is a dot that says nothing, and the
 * ordinary case should look ordinary.
 */
const RARITY_DOT: Record<BadgeRarity, string | undefined> = {
  common: undefined,
  rare: '#8FA882',
  epic: '#A98CE0',
  legendary: '#D4A24C',
  mythic: '#C4573F',
};

export interface BadgeProps {
  badge: BadgeDefinition;
  unlocked: boolean;
  size?: number;
  /** Plays the unlock animation once on mount. */
  celebrate?: boolean;
  className?: string;
}

export function Badge({ badge, unlocked, size = 72, celebrate = false, className }: BadgeProps) {
  const ink = badge.fill === 'ink';
  const dot = RARITY_DOT[badge.rarity];

  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      <span
        className={cn(
          'flex h-full w-full items-center justify-center overflow-hidden',
          badge.shape === 'squircle' ? 'rounded-[28%]' : 'rounded-full',
          celebrate && 'motion-safe:animate-badge-unlock',
          /*
           * Locked drops the contrast and nothing else.
           *
           * Desaturating came first and was wrong: it turned the cream discs
           * grey, so a locked paper badge stopped being paper. Opacity alone
           * dims the artwork while leaving both papers recognisably themselves.
           *
           * The amount is a token: 45% reads as "not yet" on a light page and
           * as "not there" on a dark one, so the dark theme lifts it.
           */
          !unlocked && 'opacity-[var(--badge-locked)]',
        )}
        style={{
          backgroundColor: ink ? INK : PAPER,
          // The accent replaces the artwork colour and nothing else.
          color: badge.accent ?? (ink ? PAPER : INK),
          ...(ink ? { boxShadow: `inset 0 0 0 1px ${INK_EDGE}` } : {}),
        }}
      >
        <BadgeArt id={badge.id as BadgeArtId} size={Math.round(size * 0.78)} />
      </span>

      {dot && unlocked ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 rounded-full"
          style={{
            width: Math.max(6, Math.round(size * 0.11)),
            height: Math.max(6, Math.round(size * 0.11)),
            backgroundColor: dot,
            // A hairline of the page behind it, so the dot reads as separate
            // from the disc rather than as a chip out of its edge.
            boxShadow: '0 0 0 2px var(--color-bg, #0B0B0C)',
          }}
        />
      ) : null}

      {/*
        The sparkle, and it is deliberately almost nothing: one ring that
        expands and fades, once. Anything more becomes a reward animation, and
        a reward animation is the thing that makes an achievement feel cheap.
      */}
      {celebrate ? (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 motion-safe:animate-badge-sparkle motion-reduce:hidden',
            badge.shape === 'squircle' ? 'rounded-[28%]' : 'rounded-full',
          )}
          style={{ boxShadow: `0 0 0 1px ${badge.accent ?? PAPER}` }}
        />
      ) : null}
    </span>
  );
}
