/**
 * One badge, opened.
 *
 * Split out of the grid because two surfaces show it — the Journey screen and,
 * later, an unlock notification — and a badge that described itself differently
 * in the two places would be two badges.
 *
 * ## What a locked badge says
 *
 * The number first, the bar second. Somebody who opens a locked badge wants to
 * know how far off they are, and "34 of 100 messages sent" answers that before
 * a bar has finished being read. The bar is the illustration, not the fact.
 */
import { Sheet } from '../../components/Sheet.js';
import { Badge } from './Badge.js';
import type { BadgeProgress } from './registry.js';

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

export function BadgeDetailSheet({
  entry,
  unlockedAt,
  onClose,
}: {
  entry: BadgeProgress;
  unlockedAt?: number;
  onClose: () => void;
}) {
  const { badge, unlocked, value, fraction } = entry;
  const { threshold, progressLabel } = badge.unlockCondition;

  return (
    <Sheet title={badge.title} hideTitle onClose={onClose}>
      <div className="flex flex-col items-center gap-5 px-6 pb-8 pt-2 text-center">
        {/*
          The unlock animation plays here rather than on the grid. On the grid it
          would fire for every earned badge every time the screen mounted, which
          turns a moment into wallpaper.
        */}
        <Badge badge={badge} unlocked={unlocked} size={104} celebrate={unlocked} />

        <div className="space-y-1.5">
          <h3 className="text-title">{badge.title}</h3>
          <p className="mx-auto max-w-xs text-body text-text-secondary">{badge.description}</p>
        </div>

        <dl className="flex items-center gap-5 text-caption text-text-tertiary">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Category</dt>
            <dd>{CATEGORY_TITLE[badge.category] ?? badge.category}</dd>
          </div>
          <span aria-hidden className="h-3 w-px bg-line" />
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Rarity</dt>
            <dd className="capitalize">{badge.rarity}</dd>
          </div>
          <span aria-hidden className="h-3 w-px bg-line" />
          <div className="flex items-center gap-1.5">
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
          <div className="w-full max-w-64 space-y-2">
            <p className="text-caption text-text-secondary">
              {value.toLocaleString()} of {threshold.toLocaleString()} {progressLabel}
            </p>
            <div
              className="h-1 w-full overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={threshold}
              aria-valuenow={value}
              aria-label={`${badge.title} progress`}
            >
              <div
                className="h-full rounded-full bg-text-tertiary transition-[width] duration-slow ease-standard"
                style={{ width: `${Math.max(2, Math.round(fraction * 100))}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
