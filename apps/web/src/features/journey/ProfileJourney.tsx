/**
 * Somebody else's Journey, on their profile.
 *
 * ## Only what they earned
 *
 * Not the locked ones. A profile is somebody's own page, and a grid of
 * twenty-two dim badges is a list of things they have not done, shown to
 * whoever opens it. Their own Journey screen is the place for the whole library
 * — there the locked ones are somewhere to go, because they are *theirs* to go
 * to. Here they would only be a measure of how far short of the set this person
 * is.
 *
 * What that costs is the sense of scale: six badges do not say what six means.
 * That is the trade, and it is the right way round — a profile should show what
 * somebody has done rather than the size of what they have not.
 *
 * ## Nothing is guessed
 *
 * Journey is counted on its owner's device, so a profile knows nothing at all
 * about somebody who has not opened the app since this shipped. That case is
 * *named* rather than hidden — hiding the section made the feature look broken
 * — and it is never filled in with a level of one or a count of zero, because
 * neither is known to be true.
 *
 * ## Only the public half
 *
 * docs/journey-philosophy.md § 5 splits Journey in two, and this shows one
 * side: the level, and the badges. Missions, Pulse, statistics, memories and
 * anything about who they talk to are not here and have no column in the table
 * this reads — a visible to-do list is a visible failure list, and Pulse names
 * other people.
 *
 * ## Nothing here can be compared with your own
 *
 * No progress bars — the viewer does not know how far along somebody else is
 * and must not. No rank, no side-by-side. The reaction being designed for is
 * "they have really been here", not "I am winning".
 */
import { Card, cn } from '@pingo/ui';
import { useState } from 'react';

import { Badge } from '../badges/Badge.js';
import { BADGES } from '../badges/registry.js';

/** Two rows of six. Past that it is a wall rather than a row of badges. */
const COLLAPSED = 12;

export function ProfileJourney({
  level,
  badgeIds,
  name,
  className,
}: {
  /** Undefined when they have never published. */
  level?: number;
  badgeIds?: readonly string[];
  /** First name, for the line about them. */
  name: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const published = level !== undefined;
  const earned = new Set(badgeIds ?? []);

  /*
   * In sheet order rather than in the order they were earned. The library has
   * an order that means something — messaging, the two times of day, calls,
   * camera, stories, people — and a handful of badges shown in that order still
   * reads as part of the set.
   */
  const theirs = BADGES.filter((badge) => earned.has(badge.id));
  const visible = expanded ? theirs : theirs.slice(0, COLLAPSED);
  const hidden = theirs.length - visible.length;

  return (
    <section className={cn('px-4', className)}>
      <Card elevation="flat" className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-body font-medium">Journey</h3>
          {published ? <p className="text-caption text-text-tertiary">Level {level}</p> : null}
        </div>

        {!published ? (
          <p className="pt-2 text-caption text-text-secondary">
            {name} hasn’t shared their Journey yet.
          </p>
        ) : theirs.length === 0 ? (
          <p className="pt-2 text-caption text-text-secondary">
            {name} is just getting started here.
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-6 gap-x-2 gap-y-4 pt-4">
              {visible.map((badge) => (
                <li key={badge.id}>
                  <div className="flex flex-col items-center gap-1.5 text-center">
                    <Badge badge={badge} unlocked size={40} />
                    <span className="line-clamp-2 text-[10px] leading-tight text-text-secondary">
                      {badge.title}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex items-baseline justify-between gap-3 pt-4">
              {/*
                What they have, never what they are missing. "6 of 28" would
                turn somebody's profile into a completion score, and the locked
                badges are absent for the same reason.
              */}
              <p className="text-caption text-text-tertiary">
                {theirs.length === 1 ? '1 badge earned' : `${theirs.length} badges earned`}
              </p>

              {hidden > 0 || expanded ? (
                <button
                  type="button"
                  onClick={() => setExpanded((open) => !open)}
                  className="focus-ring rounded-md text-caption text-brand"
                >
                  {expanded ? 'Show less' : `Show all ${theirs.length}`}
                </button>
              ) : null}
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
