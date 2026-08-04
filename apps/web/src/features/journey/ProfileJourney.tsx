/**
 * Somebody else's Journey, on their profile.
 *
 * ## The whole collection, not just what they earned
 *
 * The first version showed only their earned badges, on the reasoning that a
 * grid of things somebody has *not* done is a list of their shortcomings shown
 * to a stranger. That was wrong, and for a simple reason: a collection is only
 * legible as a collection when the empty slots are visible. Six badges floating
 * on their own say nothing about what six means. Six lit out of twenty-eight is
 * a story — and it is the same story their own Journey screen tells them, which
 * is the point of a public Journey at all.
 *
 * The locked ones are dim and silent. No progress bars, because the viewer does
 * not know how far along somebody else is and must not: progress is counted on
 * the owner's device from their own messages, and only the fact of an unlock is
 * ever published.
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
 * No "you are ahead", no rank, no side-by-side. The reaction being designed for
 * is "they have really been here", not "I am winning".
 */
import { Card, cn } from '@pingo/ui';
import { useState } from 'react';

import { Badge } from '../badges/Badge.js';
import { BADGES } from '../badges/registry.js';

/** Enough to read the shape of the collection without owning the screen. */
const COLLAPSED_ROWS = 2;
const PER_ROW = 6;

export function ProfileJourney({
  level,
  badgeIds,
  name,
  className,
}: {
  level: number;
  badgeIds: readonly string[];
  /** First name, for the empty line. */
  name: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const earned = new Set(badgeIds);

  /*
   * Their badges first, then the rest in sheet order.
   *
   * A profile should open with what they have done rather than with the first
   * six commons in the library, and the collapsed view only has room for a
   * couple of rows. Inside each half the sheet order is kept, so the set still
   * reads as the set.
   */
  const ordered = [
    ...BADGES.filter((badge) => earned.has(badge.id)),
    ...BADGES.filter((badge) => !earned.has(badge.id)),
  ];

  const visible = expanded ? ordered : ordered.slice(0, COLLAPSED_ROWS * PER_ROW);
  const hidden = ordered.length - visible.length;

  return (
    <section className={cn('px-4', className)}>
      <Card elevation="flat" className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-body font-medium">Journey</h3>
          <p className="text-caption text-text-tertiary">Level {level}</p>
        </div>

        {earned.size === 0 ? (
          <p className="pt-3 text-caption text-text-secondary">
            {name} is just getting started here.
          </p>
        ) : null}

        <ul className="grid grid-cols-6 gap-x-2 gap-y-4 pt-4">
          {visible.map((badge) => {
            const unlocked = earned.has(badge.id);
            return (
              <li key={badge.id}>
                <div className="flex flex-col items-center gap-1.5 text-center">
                  <Badge badge={badge} unlocked={unlocked} size={40} />
                  <span
                    className={cn(
                      'line-clamp-2 text-[10px] leading-tight',
                      unlocked ? 'text-text-secondary' : 'text-text-tertiary/70',
                    )}
                  >
                    {badge.title}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex items-baseline justify-between gap-3 pt-4">
          {/*
            The count reads as a collection, not as a completion score: what
            they have, out of what there is. It is only here because the whole
            library is on screen — the number was left off when the locked ones
            were, and a bare "six badges" beside a full grid would be the one
            thing on the card somebody had to work out for themselves.
          */}
          <p className="text-caption text-text-tertiary">
            {earned.size} of {BADGES.length} earned
          </p>

          {hidden > 0 || expanded ? (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              className="focus-ring rounded-md text-caption text-brand"
            >
              {expanded ? 'Show less' : `Show all ${BADGES.length}`}
            </button>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
