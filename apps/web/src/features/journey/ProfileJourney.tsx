/**
 * Somebody else's Journey, on their profile.
 *
 * ## Only the public half
 *
 * docs/journey-philosophy.md § 5 splits Journey in two, and this shows one
 * side: the level, and the badges. Missions, Pulse, statistics, memories and
 * anything about who they talk to are not here and are not in the table this
 * reads — a visible to-do list is a visible failure list, and Pulse names other
 * people.
 *
 * ## Earned only
 *
 * The owner's own screen shows the whole library with the locked ones dimmed,
 * because there it is somewhere to go. On somebody else's profile a grid of
 * things they have *not* done is a list of their shortcomings shown to a
 * stranger. Only what they earned.
 *
 * ## Nothing here can be tapped through to a number
 *
 * No progress bars, no counts of messages or calls, no comparison with the
 * viewer's own level. The reaction being designed for is "they have really been
 * here", not "I am ahead of them".
 */
import { Card, cn } from '@pingo/ui';

import { Badge } from '../badges/Badge.js';
import { BADGE_BY_ID } from '../badges/registry.js';

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
  /*
   * Newest last is how they were published, so the row reads oldest-first the
   * way a story does. Unknown ids — a badge retired since they published — are
   * dropped rather than drawn as a gap.
   */
  const badges = badgeIds.map((id) => BADGE_BY_ID.get(id)).filter((b) => b !== undefined);

  return (
    <section className={cn('px-4', className)}>
      <Card elevation="flat" className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-body font-medium">Journey</h3>
          <p className="text-caption text-text-tertiary">Level {level}</p>
        </div>

        {badges.length === 0 ? (
          <p className="pt-3 text-caption text-text-secondary">
            {name} is just getting started here.
          </p>
        ) : (
          <>
            <ul className="scrollbar-none flex gap-3 overflow-x-auto pt-3">
              {badges.map((badge) => (
                <li key={badge.id} className="shrink-0">
                  <div className="flex w-14 flex-col items-center gap-1.5 text-center">
                    <Badge badge={badge} unlocked size={46} />
                    <span className="line-clamp-2 text-[11px] leading-tight text-text-secondary">
                      {badge.title}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            {/*
              A count of what they have, and never of what they are missing.
              "6 of 28" would turn somebody's profile into a completion score.
            */}
            <p className="pt-3 text-caption text-text-tertiary">
              {badges.length === 1 ? '1 badge earned' : `${badges.length} badges earned`}
            </p>
          </>
        )}
      </Card>
    </section>
  );
}
