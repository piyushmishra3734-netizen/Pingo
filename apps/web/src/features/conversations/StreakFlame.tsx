/**
 * The streak flame, in three tiers.
 *
 * ## Why the number alone was not enough, and why the emoji was worse
 *
 * The count shipped as a bare tabular number because the first attempt — a 🔥
 * emoji beside the name — read as a Snapchat unread signal and fought the
 * purple badge for the same corner of the row. The number that replaced it is
 * honest and completely inert: nobody has ever looked forward to a small grey
 * eight.
 *
 * What is drawn here is neither. It is a flame that belongs to PINGO's own
 * drawing — the same warm palette as the badges, no emoji font, no third-party
 * asset — and it earns its motion rather than starting with it.
 *
 * ## The tiers, and what each one is allowed to do
 *
 * | Days | What it is | Motion |
 * | --- | --- | --- |
 * | 1–6 | An ember. Small, warm, still. | none |
 * | 7–89 | A flame. | flickers |
 * | 90+ | A blue-hot flame. | flickers, with a glow |
 *
 * The first week is deliberately still. A conversation three days old is not an
 * achievement yet, and animating it would make every new chat in the list
 * flicker at once — which is both noisy and a lie about what has happened. The
 * fire arrives when a week of talking has, and the blue one when three months
 * have; those are the two moments worth looking up for.
 *
 * ## It must not shout on a list of conversations
 *
 * Fifteen pixels, tucked in the meta line beside the timestamp, and never in
 * the unread badge's colour. The chats list is for finding a person to talk to;
 * this is a detail somebody notices on the way past, not a thing competing with
 * the reason they opened the app.
 */
import { cn } from '@pingo/ui';

export type StreakTier = 'none' | 'ember' | 'flame' | 'blue';

/** A week to catch fire, three months to burn blue. */
export const FLAME_DAYS = 7;
export const BLUE_DAYS = 90;

/**
 * Which flame a streak of `days` deserves.
 *
 * Zero, absent and negative are all `none` — a streak is a reward, and drawing
 * an empty one would turn it into a scoreboard nobody asked to be on. That was
 * already the rule for the number and it stays the rule for the flame.
 */
export function streakTier(days: number | undefined): StreakTier {
  if (!days || days < 1) return 'none';
  if (days < FLAME_DAYS) return 'ember';
  if (days < BLUE_DAYS) return 'flame';
  return 'blue';
}

/** The reference palette's warm end, and one cold end for the long one. */
const PALETTE = {
  ember: { outer: '#C4573F', inner: '#D4A24C' },
  flame: { outer: '#D8642F', inner: '#F0B03C' },
  blue: { outer: '#3E7BD1', inner: '#BFE3FF' },
} as const;

export function StreakFlame({
  days,
  size = 15,
  className,
}: {
  days: number | undefined;
  size?: number;
  className?: string;
}) {
  const tier = streakTier(days);
  if (tier === 'none') return null;

  const colours = PALETTE[tier];
  const moving = tier !== 'ember';

  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      title={`${days}-day streak`}
    >
      {/*
        The glow, on the long streak only. It is a blurred disc behind the
        flame rather than a filter on it — a real blur on a list row is a
        repaint per scrolled pixel, and this is a radial gradient that the
        compositor can leave alone.
      */}
      {tier === 'blue' ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-[-35%] rounded-full motion-safe:animate-flame-glow motion-reduce:opacity-30"
          style={{
            background: `radial-gradient(circle, ${colours.inner}55 0%, transparent 65%)`,
          }}
        />
      ) : null}

      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden
        focusable="false"
        className={cn('relative', moving && 'motion-safe:animate-flame-body')}
      >
        {/*
          The body. Drawn as one closed path with an uneven left and right so it
          never reads as a symmetrical teardrop — real flame is lopsided, and
          the asymmetry is most of what sells it while it moves.
        */}
        <path
          fill={colours.outer}
          d="M12.6 1.8c.5 3.1-.8 4.4-2.3 6-1.7 1.8-3.6 3.7-3.6 7 0 3.4 2.5 6 5.7 6s5.9-2.5 5.9-6c0-2.6-1.1-4.6-2.4-6.2-.2 1-.7 1.8-1.5 2.3.5-3.6-.5-6.6-1.8-9.1Z"
        />

        {/*
          The core, lighter and shorter, running on its own clock. Two flames at
          different speeds is the difference between fire and a wobbling icon.
        */}
        <path
          fill={colours.inner}
          className={cn(moving && 'motion-safe:animate-flame-core')}
          d="M12.2 11.4c.9 1.3.4 2.3.9 3.1.5-.4.7-1 .7-1.6 1 1.1 1.5 2.3 1.5 3.4 0 1.9-1.5 3.3-3.3 3.3s-3.3-1.4-3.3-3.3c0-1.4.7-2.6 1.7-3.5.4.7.1 1.4.6 1.9.6-.8.3-2 1.2-3.3Z"
        />
      </svg>
    </span>
  );
}
