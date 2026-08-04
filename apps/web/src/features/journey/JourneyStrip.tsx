/**
 * The Journey strip on the chats list.
 *
 * ## It must invite, without competing
 *
 * Two rules pull against each other here, and both are real. Somebody opening
 * PINGO came to talk to a person, so this may not dominate the list. But the
 * first version obeyed only that rule and became a settings row: a level, a
 * hairline bar and a fraction, in the same grey as everything around it. Nobody
 * taps a settings row twice.
 *
 * What it has now is one thing worth looking at — the next badge, drawn in its
 * real artwork — and a line that says what that badge is *for*. The pull is
 * curiosity about a specific thing, not a number creeping towards a target. It
 * is still one row, still fixed height, still no call to action.
 *
 * ## The badge is the near one, never the rarest
 *
 * Showing the mythic badge would be a shop window. Showing the one a few
 * conversations away is showing somebody where they already are.
 */
import { cn } from '@pingo/ui';
import { useNavigate } from 'react-router-dom';

import { Badge } from '../badges/Badge.js';
import type { BadgeProgress } from '../badges/registry.js';
import type { JourneyLevel, Mission } from './dummy-journey.js';

export function JourneyStrip({
  level,
  missions,
  note,
  next,
  className,
}: {
  level: JourneyLevel;
  missions: Mission[];
  /** One short line. Never a number — the numbers are already here. */
  note: string;
  /** The closest unearned badge, if there is one. */
  next?: BadgeProgress;
  className?: string;
}) {
  const navigate = useNavigate();
  const done = missions.filter((m) => m.done >= m.target).length;
  const percent = level.xpForLevel <= 0 ? 100 : Math.round((level.xpIntoLevel / level.xpForLevel) * 100);

  const remaining = next
    ? Math.max(1, next.badge.unlockCondition.threshold - next.value)
    : 0;

  return (
    <button
      type="button"
      onClick={() => navigate('/profile/journey')}
      aria-label={
        next
          ? `Journey. Level ${level.level}. ${remaining} more ${next.badge.unlockCondition.progressLabel} until ${next.badge.title}.`
          : `Journey. Level ${level.level}.`
      }
      className={cn(
        'mx-4 mb-2 flex w-[calc(100%-2rem)] items-center gap-3 rounded-xl',
        /*
         * A faint wash of the brand rather than the same surface as a chat row.
         * It is the one thing in the list that is not a conversation, and it
         * should look like it — quietly, at ten per cent.
         */
        'border border-brand/15 bg-brand/[0.06] px-3 py-2.5 text-left',
        'transition-transform duration-instant ease-standard',
        'active:scale-[0.99] motion-reduce:active:scale-100',
        className,
      )}
    >
      {/*
        The artwork, at the size it is drawn to be read at.

        This is the whole difference between a row somebody taps and a row
        somebody scrolls past: a specific object, half-earned, rather than a
        progress bar in the abstract. Locked, so it reads as somewhere to go.
      */}
      {next ? (
        <span className="relative shrink-0">
          <Badge badge={next.badge} unlocked={false} size={38} />
          {/*
            A ring that fills as the badge does. It sits on the artwork rather
            than under the text, so the progress belongs to the thing it is
            progress towards.
          */}
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-1 rounded-full"
            style={{
              background: `conic-gradient(var(--color-brand, #6C5CE7) ${Math.round(next.fraction * 360)}deg, transparent 0deg)`,
              mask: 'radial-gradient(circle, transparent 62%, black 64%)',
              WebkitMask: 'radial-gradient(circle, transparent 62%, black 64%)',
            }}
          />
        </span>
      ) : null}

      <div className="min-w-0 flex-1">
        {/*
          What is nearly earned, named. "3 more voice notes" is a sentence about
          something real; "Level 6" is a number about nothing in particular, so
          it moves to the quiet end of the row.
        */}
        {next ? (
          <p className="truncate text-body font-medium">
            {remaining} more {next.badge.unlockCondition.progressLabel}
          </p>
        ) : (
          <p className="truncate text-body font-medium">Level {level.level}</p>
        )}

        <p className="truncate pt-0.5 text-caption text-text-secondary">
          {next ? `until ${next.badge.title} · ${note}` : note}
        </p>

        {/*
          The level bar, thinner than before and below the words rather than
          above them. It is still here — it is the only thing that shows the
          whole journey rather than the next step of it.
        */}
        <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-sunken">
          <div
            className="h-full rounded-full bg-brand/70 transition-[width] duration-slow ease-standard"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-caption text-text-tertiary">Level</p>
        <p className="text-body font-medium tabular-nums">{level.level}</p>
        {done > 0 ? (
          <p className="text-caption text-text-tertiary tabular-nums">
            {done}/{missions.length} today
          </p>
        ) : null}
      </div>
    </button>
  );
}
