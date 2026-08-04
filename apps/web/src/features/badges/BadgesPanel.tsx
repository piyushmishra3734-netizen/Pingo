/**
 * Profile → Journey → Badges.
 *
 * ## Locked badges stay on the grid
 *
 * The collection is the feature. A page that shows only what you have earned is
 * a receipt; a page that shows the whole set with most of it dimmed is somewhere
 * to go. Only a badge marked `hiddenUntilUnlocked` is withheld, and almost none
 * are — see the note on that field.
 *
 * ## Progress is shown on the badge that is closest, not on all of them
 *
 * A bar under all twenty-four is noise, and most of them will read zero. The
 * detail sheet carries the number for whichever badge was tapped, which is the
 * moment somebody actually wants it.
 */
import { useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { Badge } from './Badge.js';
import { libraryFor, type BadgeMetrics, type BadgeProgress } from './registry.js';

const CATEGORY_TITLE: Record<string, string> = {
  messaging: 'Messaging',
  lifestyle: 'Lifestyle',
  calls: 'Calls',
  camera: 'Camera',
  stories: 'Stories',
  friendship: 'Friendship',
  ai: 'AI',
  learning: 'Learning',
  goals: 'Goals',
};

export interface BadgesPanelProps {
  metrics: BadgeMetrics;
  unlockedIds?: ReadonlySet<string>;
  /** When each badge was earned, for the detail sheet. */
  unlockedAt?: Readonly<Record<string, number>>;
}

export function BadgesPanel({ metrics, unlockedIds, unlockedAt }: BadgesPanelProps) {
  const entries = libraryFor(metrics, unlockedIds);
  const [open, setOpen] = useState<BadgeProgress | undefined>();

  const earned = entries.filter((e) => e.unlocked).length;

  return (
    <section className="px-4 pb-8">
      <header className="flex items-baseline justify-between pb-4 pt-2">
        <h2 className="text-body font-medium">Badges</h2>
        <p className="text-caption text-text-secondary">
          {earned} of {entries.length}
        </p>
      </header>

      {/*
        Four across on a phone. Five would fit and would turn each badge into an
        icon; the sheet is drawn to be looked at, so it is given the room.
      */}
      <ul className="grid grid-cols-4 gap-x-3 gap-y-6 sm:grid-cols-6">
        {entries.map((entry) => (
          <li key={entry.badge.id}>
            <button
              type="button"
              onClick={() => setOpen(entry)}
              className="flex w-full flex-col items-center gap-2 text-center"
            >
              <Badge badge={entry.badge} unlocked={entry.unlocked} size={64} />
              <span
                className={cnLabel(entry.unlocked)}
                // Two lines maximum, then it truncates. "10 Hours Together" is
                // the longest title in the library and it fits.
              >
                {entry.badge.title}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/*
        Mounted only while open, which is how every other sheet in the app
        behaves — and it means the detail view starts fresh each time, so the
        unlock animation plays on the badge that was actually tapped.
      */}
      {open ? (
        <Sheet
          title={open.badge.title}
          hideTitle
          onClose={() => setOpen(undefined)}
        >
          <BadgeDetail entry={open} unlockedAt={unlockedAt?.[open.badge.id]} />
        </Sheet>
      ) : null}
    </section>
  );
}

function cnLabel(unlocked: boolean): string {
  return [
    'line-clamp-2 text-caption leading-tight',
    unlocked ? 'text-text-primary' : 'text-text-tertiary',
  ].join(' ');
}

function BadgeDetail({ entry, unlockedAt }: { entry: BadgeProgress; unlockedAt?: number }) {
  const { badge, unlocked, value, fraction } = entry;
  const { threshold, progressLabel } = badge.unlockCondition;

  return (
    <div className="flex flex-col items-center gap-4 px-6 pb-8 pt-2 text-center">
      <Badge badge={badge} unlocked={unlocked} size={104} celebrate={unlocked} />

      <div className="space-y-1">
        <h3 className="text-title">{badge.title}</h3>
        <p className="text-body text-text-secondary">{badge.description}</p>
      </div>

      <dl className="flex items-center gap-6 text-caption text-text-tertiary">
        <div>
          <dt className="sr-only">Category</dt>
          <dd>{CATEGORY_TITLE[badge.category] ?? badge.category}</dd>
        </div>
        <div>
          <dt className="sr-only">Rarity</dt>
          <dd className="capitalize">{badge.rarity}</dd>
        </div>
        <div>
          <dt className="sr-only">Reward</dt>
          <dd>{badge.xpReward} XP</dd>
        </div>
      </dl>

      {unlocked ? (
        <p className="text-caption text-text-secondary">
          {unlockedAt
            ? `Earned ${new Date(unlockedAt).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}`
            : 'Earned'}
        </p>
      ) : (
        /*
         * The number, then the bar. Someone checking a locked badge wants to
         * know how far off they are, and "34 of 100 messages sent" answers that
         * before the bar has finished being read.
         */
        <div className="w-full max-w-56 space-y-2">
          <p className="text-caption text-text-secondary">
            {value.toLocaleString()} of {threshold.toLocaleString()} {progressLabel}
          </p>
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-text-tertiary transition-[width] duration-slow ease-standard"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
