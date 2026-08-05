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
import type { JourneyLevel } from './dummy-journey.js';

export function JourneyStrip({
  level,
  note,
  next,
  className,
}: {
  level: JourneyLevel;
  /** One short line. Never a number — the numbers are already here. */
  note: string;
  /** The closest unearned badge, if there is one. */
  next?: BadgeProgress;
  className?: string;
}) {
  const navigate = useNavigate();
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
         * The same surface as everything else in the list.
         *
         * It had a brand-coloured wash and border, to stop it reading as a
         * settings row. The badge does that job on its own, and the tint only
         * made the row look like a promotion.
         */
        'border border-line/60 bg-surface/70 px-3 py-2.5 text-left',
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
      {next ? <Badge badge={next.badge} unlocked={false} size={38} className="shrink-0" /> : null}

      <div className="min-w-0 flex-1">
        {/*
          What is nearly earned, named. "3 more voice notes" is a sentence about
          something real; "Level 6" is a number about nothing in particular, so
          it moves to the quiet end of the row.
        */}
        {/*
          Two lines, and the sentence is allowed to wrap onto the second.

          It truncated at "29 more messages after …" in the desktop sidebar,
          which is the narrowest place this appears — and a sentence cut before
          its subject is worse than no sentence. Some progress labels are simply
          long ("messages after midnight"), so the fix is room rather than
          shorter words.

          The feeling line goes with it when a badge is showing. It was
          "until Night Owl · Building new connections", two thoughts fighting
          for one line; the phrase is already on the Journey screen, and the
          badge is what this row is for.
        */}
        {next ? (
          <>
            <p className="line-clamp-2 text-body font-medium leading-snug">
              {remaining} more {next.badge.unlockCondition.progressLabel}
            </p>
            <p className="truncate pt-0.5 text-caption text-text-secondary">
              until {next.badge.title}
            </p>
          </>
        ) : (
          <>
            <p className="truncate text-body font-medium">Level {level.level}</p>
            <p className="truncate pt-0.5 text-caption text-text-secondary">{note}</p>
          </>
        )}

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

      {/*
        Nothing on the right at all.

        This has been, in order: a three-line column of "Level / 2 / 1/3 today",
        then a coloured "Lv 2" pill. Both were chrome. The level is on the
        Journey screen and on the profile, it is not what this row is about, and
        a pill beside a drawn badge is one decoration too many — enough of them
        and a screen stops looking designed and starts looking generated.

        What is left is the artwork, a sentence, and a hairline. The badge is
        the thing worth looking at; everything that competed with it is gone.
      */}
    </button>
  );
}
