/**
 * The Journey strip on the chats list.
 *
 * ## It must not compete with the conversations
 *
 * Somebody opening PINGO came to talk to a person, not to check a level. So
 * this is one row, fixed low height, no artwork, no badge, no call to action —
 * a reminder that something is being built, placed where it will be seen and
 * sized so it can be ignored. The moment it starts pulling attention away from
 * the list below it, it has become the thing the philosophy rules out.
 *
 * The whole row is the tap target, because a small "View" button inside a small
 * strip is a target nobody hits and an instruction nobody needs.
 */
import { cn } from '@pingo/ui';
import { useNavigate } from 'react-router-dom';

import type { JourneyLevel, Mission } from './dummy-journey.js';

export function JourneyStrip({
  level,
  missions,
  note,
  className,
}: {
  level: JourneyLevel;
  missions: Mission[];
  /** One short line. Never a number — the numbers are already here. */
  note: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const done = missions.filter((m) => m.done >= m.target).length;
  const percent = level.xpForLevel <= 0 ? 100 : Math.round((level.xpIntoLevel / level.xpForLevel) * 100);

  return (
    <button
      type="button"
      onClick={() => navigate('/profile/journey')}
      aria-label={`Journey. Level ${level.level}, ${percent} percent. ${done} of ${missions.length} of today complete.`}
      className={cn(
        'mx-4 mb-2 flex w-[calc(100%-2rem)] items-center gap-3 rounded-xl',
        'border border-line/60 bg-surface/70 px-3.5 py-2.5 text-left',
        'transition-transform duration-instant ease-standard',
        'active:scale-[0.99] motion-reduce:active:scale-100',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-body font-medium">Level {level.level}</span>
          <span className="text-caption tabular-nums text-text-tertiary">{percent}%</span>
        </div>

        {/*
          One bar, thin. A thicker bar or a second one for the missions would
          make the strip a dashboard, and a dashboard is a thing you stop to
          read rather than glance at on the way past.
        */}
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-sunken">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-slow ease-standard"
            style={{ width: `${percent}%` }}
          />
        </div>

        <p className="truncate pt-1.5 text-caption text-text-secondary">{note}</p>
      </div>

      {/*
        Today's count as a fraction, not a ring or a set of dots. Three dots
        would be three small things to decode; "2/3" is read in one movement.
      */}
      <div className="shrink-0 text-right">
        <p className="text-caption text-text-tertiary">Today</p>
        <p className="text-body tabular-nums">
          {done}/{missions.length}
        </p>
      </div>
    </button>
  );
}
