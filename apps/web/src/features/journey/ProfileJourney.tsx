/**
 * The badges somebody has earned, on their profile.
 *
 * ## A row, not a section
 *
 * This was a titled card — a "Journey" heading, a level, a line of copy about
 * what was or was not shared. On a profile that is a box announcing itself, and
 * a profile is already a column of boxes. What is left is the only thing that
 * was ever worth showing: the badges, and how many there are.
 *
 * No heading, no level, no sentence. If somebody has earned nothing, or has
 * never published, nothing is drawn at all — an empty row is quieter than a box
 * explaining why it is empty.
 *
 * ## Five, then the collection
 *
 * Five is what fits without the profile turning into a trophy shelf, and it is
 * enough to see what kind of person's page this is. "Collection" opens the whole
 * library for anybody curious about what there is to earn — going to look is a
 * different act from being shown a list of what somebody has not done.
 *
 * ## Only the public half
 *
 * docs/journey-philosophy.md § 5: badges are public, and missions, Pulse,
 * statistics and memories are not. None of them have a column in the table this
 * reads. No progress bars either — how far along somebody else is is theirs.
 */
import { cn } from '@pingo/ui';
import { useState } from 'react';

import { Badge } from '../badges/Badge.js';
import { BADGES } from '../badges/registry.js';

/** Enough to show who this is, not enough to become a shelf. */
const SHOWN = 5;

export function ProfileJourney({
  badgeIds,
  className,
}: {
  /** Undefined when they have never published. */
  badgeIds?: readonly string[];
  className?: string;
}) {
  /** The whole library, only when asked for. */
  const [collection, setCollection] = useState(false);
  const earned = new Set(badgeIds ?? []);

  /*
   * Sheet order rather than the order they were earned: the library has an
   * order that means something, and a handful shown in it still reads as part
   * of the set.
   */
  const theirs = BADGES.filter((badge) => earned.has(badge.id));

  // Nothing earned, or nothing published. Draw nothing rather than a box
  // explaining itself.
  if (theirs.length === 0) return null;

  const visible = collection ? BADGES : theirs.slice(0, SHOWN);

  return (
    <section className={cn('px-4', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-caption text-text-tertiary">
          {theirs.length === 1 ? '1 badge earned' : `${theirs.length} badges earned`}
        </p>

        <button
          type="button"
          onClick={() => setCollection((open) => !open)}
          className="focus-ring rounded-md text-caption text-text-secondary underline underline-offset-2"
        >
          {collection ? 'Earned only' : 'Collection'}
        </button>
      </div>

      <ul
        className={cn(
          'gap-x-1 gap-y-4 pt-3',
          // Five in a row while it is a summary; the full library needs a grid.
          collection ? 'grid grid-cols-6' : 'flex',
        )}
      >
        {visible.map((badge) => {
          const unlocked = earned.has(badge.id);
          return (
            <li key={badge.id} className={collection ? undefined : 'shrink-0'}>
              <div className="flex w-16 flex-col items-center gap-1.5 text-center">
                <Badge badge={badge} unlocked={unlocked} size={48} />
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
    </section>
  );
}
